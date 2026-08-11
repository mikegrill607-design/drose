-- Meta sends delivery-status webhook events (sent/delivered/read/failed,
-- with a real error reason on failure) for every outbound message, but the
-- webhook handler was only ever reading value.messages (inbound) and
-- silently ignoring value.statuses (outbound delivery results) entirely.
-- That's the actual source of "the API says sent but did it really arrive?"
-- uncertainty -- this makes that answerable from the DB instead of guesswork.
alter table messages add column if not exists delivery_status text; -- sent | delivered | read | failed | null (not yet reported)
alter table messages add column if not exists delivery_error text; -- Meta's error detail, only set when delivery_status = 'failed'
