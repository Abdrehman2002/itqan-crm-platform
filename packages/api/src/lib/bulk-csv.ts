/**
 * Shared helpers for the POST /:resource/bulk endpoints.
 *
 * Each /bulk endpoint accepts a multipart upload with a single .csv file,
 * parses it with csv-parse, validates per-row with a caller-supplied Zod
 * schema, and bulk-inserts inside the existing `db.withTenant(...)`
 * transaction (so a mid-stream failure rolls back partially-loaded data).
 *
 * The pattern is intentionally narrow: straight inserts, no dedup, no
 * upserts. If a row collides on a UNIQUE constraint we surface the DB
 * error against that row and move on.
 */
import { parse as parseCsvSync } from 'csv-parse/sync';
import type { MultipartFile } from '@fastify/multipart';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ZodSchema } from 'zod';

const MAX_BYTES = 5 * 1024 * 1024;     // 5 MB
const MAX_ROWS  = 5000;                 // hard cap so a typo doesn't OOM us

export interface BulkRowError {
  row: number;
  errors: string[];
}

export interface BulkResult<T> {
  inserted: number;
  failed: BulkRowError[];
  rows?: T[]; // optionally surfaced rows that succeeded
}

/**
 * Reads the multipart file from a Fastify request, enforces size + format,
 * and returns the parsed rows (header → value map). Throws a Fastify reply
 * on validation failure so callers can `return` it directly.
 */
export async function readCsvFromRequest(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<Record<string, string>[] | undefined> {
  let file: MultipartFile | undefined;
  try {
    file = await req.file();
  } catch (err: any) {
    reply.code(400).send({
      success: false,
      error: { code: 'BAD_UPLOAD', message: err?.message ?? 'Invalid upload' },
    });
    return undefined;
  }

  if (!file) {
    reply.code(400).send({
      success: false,
      error: { code: 'NO_FILE', message: 'No CSV file supplied (multipart field "file")' },
    });
    return undefined;
  }

  // Collect the stream into a buffer with a hard size cap.
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of file.file) {
    total += chunk.length;
    if (total > MAX_BYTES) {
      reply.code(413).send({
        success: false,
        error: { code: 'TOO_LARGE', message: `CSV exceeds ${MAX_BYTES / (1024 * 1024)} MB limit` },
      });
      return undefined;
    }
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');

  let rows: Record<string, string>[];
  try {
    rows = parseCsvSync(text, {
      columns: (header: string[]) => header.map((h) => h.trim().toLowerCase()),
      skip_empty_lines: true,
      trim: true,
      bom: true,
    }) as Record<string, string>[];
  } catch (err: any) {
    reply.code(400).send({
      success: false,
      error: { code: 'PARSE_ERROR', message: err?.message ?? 'Could not parse CSV' },
    });
    return undefined;
  }

  if (rows.length === 0) {
    reply.code(400).send({
      success: false,
      error: { code: 'EMPTY', message: 'CSV has a header but no data rows' },
    });
    return undefined;
  }
  if (rows.length > MAX_ROWS) {
    reply.code(400).send({
      success: false,
      error: { code: 'TOO_MANY_ROWS', message: `Maximum ${MAX_ROWS} rows per upload` },
    });
    return undefined;
  }

  return rows;
}

/**
 * Validates each raw row against the supplied Zod schema. Rows that fail are
 * pushed to `failed` (with 1-based row numbers including the header row, so
 * row 2 = first data row). Successful rows are returned with their original
 * 1-based row index so the inserter can report back accurately.
 */
export function validateRows<T>(
  rows: Record<string, string>[],
  schema: ZodSchema<T>,
): { valid: { row: number; value: T }[]; failed: BulkRowError[] } {
  const valid: { row: number; value: T }[] = [];
  const failed: BulkRowError[] = [];

  rows.forEach((raw, i) => {
    const rowNum = i + 2; // +1 for 1-based, +1 for header
    const parsed = schema.safeParse(raw);
    if (parsed.success) {
      valid.push({ row: rowNum, value: parsed.data });
    } else {
      failed.push({
        row: rowNum,
        errors: parsed.error.issues.map((iss) =>
          `${iss.path.join('.') || 'row'}: ${iss.message}`,
        ),
      });
    }
  });

  return { valid, failed };
}
