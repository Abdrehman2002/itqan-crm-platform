/**
 * File Storage Abstraction
 *
 * STORAGE_BACKEND=local  → reads/writes to local filesystem (default, dev)
 * STORAGE_BACKEND=s3     → reads/writes to S3-compatible bucket
 *
 * S3 env vars (when STORAGE_BACKEND=s3):
 *   S3_BUCKET        — bucket name
 *   S3_REGION        — AWS region (default: us-east-1)
 *   S3_ENDPOINT      — optional custom endpoint (for MinIO, R2, DigitalOcean Spaces)
 *   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY — credentials
 */

import { createWriteStream, createReadStream, mkdirSync } from 'fs';
import { pipeline } from 'stream/promises';
import { join } from 'path';
import { randomUUID } from 'crypto';
import type { Readable } from 'stream';

export type StoredFile = {
  /** The key to persist in the DB — filesystem path (local) or S3 key (s3) */
  key: string;
  /** Original file name for Content-Disposition headers */
  originalName: string;
};

export type FileStorage = {
  /** Save a stream to storage. Returns the key to store in the DB. */
  save(stream: Readable, originalName: string, folder: string): Promise<StoredFile>;
  /** Return the file as a Buffer for in-memory use (e.g. docxtemplater). */
  load(key: string): Promise<Buffer>;
  /** Delete the file from storage. */
  remove(key: string): Promise<void>;
};

// ── Local Filesystem ─────────────────────────────────────────────────────────

function localStorage(rootDir: string): FileStorage {
  return {
    async save(stream, originalName, folder) {
      const dir = join(rootDir, folder);
      mkdirSync(dir, { recursive: true });
      const ext = originalName.split('.').pop() ?? 'bin';
      const filename = `${randomUUID()}.${ext}`;
      const fullPath = join(dir, filename);
      await pipeline(stream, createWriteStream(fullPath));
      return { key: fullPath, originalName };
    },

    async load(key) {
      const { readFileSync } = await import('fs');
      return readFileSync(key);
    },

    async remove(key) {
      const { unlinkSync } = await import('fs');
      try { unlinkSync(key); } catch { /* already gone */ }
    },
  };
}

// ── S3-compatible ─────────────────────────────────────────────────────────────
// Uses the AWS SDK v3 which is installed only when STORAGE_BACKEND=s3.
// Import is dynamic so the package is not required in local/dev environments.

function s3Storage(bucket: string): FileStorage {
  return {
    async save(stream, originalName, folder) {
      const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
      const ext = originalName.split('.').pop() ?? 'bin';
      const key = `${folder}/${randomUUID()}.${ext}`;
      const client = buildS3Client();

      // Collect stream into buffer — multipart upload for large files is future work
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      const body = Buffer.concat(chunks);

      await client.send(new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: mimeFromExt(ext),
      }));

      return { key, originalName };
    },

    async load(key) {
      const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3');
      const client = buildS3Client();
      const resp = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      const chunks: Buffer[] = [];
      for await (const chunk of resp.Body as any) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      return Buffer.concat(chunks);
    },

    async remove(key) {
      const { S3Client, DeleteObjectCommand } = await import('@aws-sdk/client-s3');
      const client = buildS3Client();
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
}

function buildS3Client() {
  const { S3Client } = require('@aws-sdk/client-s3');
  return new S3Client({
    region:   process.env.S3_REGION ?? 'us-east-1',
    endpoint: process.env.S3_ENDPOINT,           // set for MinIO / R2 / DO Spaces
    forcePathStyle: !!process.env.S3_ENDPOINT,   // required for non-AWS endpoints
  });
}

function mimeFromExt(ext: string): string {
  const map: Record<string, string> = {
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    html: 'text/html',
    pdf:  'application/pdf',
  };
  return map[ext] ?? 'application/octet-stream';
}

// ── Factory — reads STORAGE_BACKEND env var ───────────────────────────────────

const UPLOADS_ROOT = process.env.UPLOADS_DIR ?? join(process.cwd(), 'uploads', 'templates');

export function buildFileStorage(): FileStorage {
  const backend = process.env.STORAGE_BACKEND ?? 'local';
  if (backend === 's3') {
    const bucket = process.env.S3_BUCKET;
    if (!bucket) throw new Error('S3_BUCKET env var is required when STORAGE_BACKEND=s3');
    return s3Storage(bucket);
  }
  return localStorage(UPLOADS_ROOT);
}
