ALTER TABLE {{schema}}.appointments
  DROP CONSTRAINT IF EXISTS appointments_payment_method_check;

ALTER TABLE {{schema}}.appointments
  ADD CONSTRAINT appointments_payment_method_check
  CHECK (payment_method IN ('pending', 'cash', 'card', 'voucher', 'gift'));
