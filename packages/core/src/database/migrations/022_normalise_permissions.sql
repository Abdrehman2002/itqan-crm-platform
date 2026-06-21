-- Migrate old shorthand permissions { "contacts": "full"|"view"|"none" }
-- to granular format { "contacts:read": true, "contacts:create": true, ... }
-- Only touches roles that still use the old format (has "contacts" key but not "contacts:read").

DO $$
DECLARE
  r RECORD;
  old_perms JSONB;
  new_perms JSONB;
  mod_key   TEXT;
  mod_val   TEXT;

  -- All granular action keys grouped by module
  module_actions JSONB := '{
    "dashboard":    ["dashboard:read"],
    "contacts":     ["contacts:read","contacts:create","contacts:edit","contacts:delete"],
    "companies":    ["companies:read","companies:create","companies:edit","companies:delete"],
    "deals":        ["deals:read","deals:create","deals:move","deals:close","deals:delete"],
    "activities":   ["activities:read","activities:create","activities:edit","activities:complete","activities:delete"],
    "tickets":      ["tickets:read","tickets:create","tickets:assign","tickets:resolve","tickets:delete"],
    "emails":       ["emails:read","emails:compose","emails:reply","emails:delete"],
    "analytics":    ["analytics:read","analytics:export"],
    "voice":        ["voice:read","voice:call","voice:recordings"],
    "voicebot":     ["voicebot:read","voicebot:configure"],
    "integrations": ["integrations:read","integrations:configure"],
    "settings":     ["settings:read","settings:edit"],
    "billing":      ["billing:read","billing:manage"]
  }'::JSONB;

  action_key TEXT;
  action_type TEXT;  -- whether action key ends in :read or is a write

BEGIN
  FOR r IN
    SELECT id, name, permissions
    FROM roles
    WHERE permissions ? 'contacts'        -- old format has bare module keys
      AND NOT (permissions ? 'contacts:read')  -- new format already converted
  LOOP
    old_perms := r.permissions;
    new_perms := '{}'::JSONB;

    FOR mod_key IN SELECT jsonb_object_keys(old_perms)
    LOOP
      mod_val := old_perms ->> mod_key;  -- "full", "view", or "none"

      IF module_actions ? mod_key THEN
        FOR action_key IN SELECT jsonb_array_elements_text(module_actions -> mod_key)
        LOOP
          -- "full"  → all actions true
          -- "view"  → only :read actions true, write/danger false
          -- "none"  → all false
          IF mod_val = 'full' THEN
            new_perms := new_perms || jsonb_build_object(action_key, true);
          ELSIF mod_val = 'view' THEN
            -- read-type actions: key contains ':read' or ':recordings'
            IF action_key LIKE '%:read' OR action_key LIKE '%:recordings' THEN
              new_perms := new_perms || jsonb_build_object(action_key, true);
            ELSE
              new_perms := new_perms || jsonb_build_object(action_key, false);
            END IF;
          ELSE
            -- "none" or anything else
            new_perms := new_perms || jsonb_build_object(action_key, false);
          END IF;
        END LOOP;
      END IF;
    END LOOP;

    UPDATE roles SET permissions = new_perms, updated_at = NOW() WHERE id = r.id;
    RAISE NOTICE 'Migrated role "%" (id=%)', r.name, r.id;
  END LOOP;
END $$;
