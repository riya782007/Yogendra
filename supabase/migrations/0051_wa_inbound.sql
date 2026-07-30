-- (deprecated / no-op) The WhatsApp auto-reply webhook logs inbound + outbound messages in the
-- existing `whatsapp_messages` table (unique index on wa_message_id already dedupes Meta retries),
-- so the separate wa_inbound table is not needed. Left as a no-op to keep migration numbering stable.
select 1;
