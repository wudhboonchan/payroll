-- Ordinary advances have two independent slots per employee and payroll period.
-- Carryovers and special deductions do not consume a slot.
ALTER TABLE public.advance_payments ADD COLUMN advance_number smallint;

WITH ranked AS (
  SELECT id, row_number() OVER (
    PARTITION BY period_id, employee_id
    ORDER BY request_date NULLS LAST, created_at NULLS LAST, id
  ) AS round_number
  FROM public.advance_payments
  WHERE NOT coalesce(is_carryover, false)
    AND coalesce(notes, '') !~ '(สแกนหน้าไม่สำเร็จ|หักทำผิดวินัย|หักผิดวินัย|ค่าปรับผิดระเบียบ|หักค่าปรับ จป\.|ลงโทษ ขาดงาน|ลงโทษ ขาด/ลา/มาสาย)'
)
UPDATE public.advance_payments AS payment
SET advance_number = ranked.round_number
FROM ranked WHERE payment.id = ranked.id;

ALTER TABLE public.advance_payments
  ADD CONSTRAINT advance_payments_round_check CHECK (advance_number IN (1, 2));
CREATE UNIQUE INDEX advance_payments_employee_period_round_unique
  ON public.advance_payments (period_id, employee_id, advance_number)
  WHERE advance_number IS NOT NULL;

CREATE FUNCTION public.assign_advance_payment_round()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF coalesce(NEW.is_carryover, false)
    OR coalesce(NEW.notes, '') ~ '(สแกนหน้าไม่สำเร็จ|หักทำผิดวินัย|หักผิดวินัย|ค่าปรับผิดระเบียบ|หักค่าปรับ จป\.|ลงโทษ ขาดงาน|ลงโทษ ขาด/ลา/มาสาย)' THEN
    NEW.advance_number := NULL;
  ELSIF NEW.advance_number IS NULL THEN
    -- Compatibility with existing clients that do not yet send a round.
    SELECT candidate INTO NEW.advance_number
    FROM generate_series(1, 2) AS candidate
    WHERE NOT EXISTS (
      SELECT 1 FROM public.advance_payments AS payment
      WHERE payment.period_id = NEW.period_id
        AND payment.employee_id = NEW.employee_id
        AND payment.advance_number = candidate
        AND payment.id <> NEW.id
    )
    ORDER BY candidate LIMIT 1;
    IF NEW.advance_number IS NULL THEN
      RAISE EXCEPTION 'พนักงานนี้มีรายการเบิกครบ 2 ครั้งในงวดนี้แล้ว' USING ERRCODE = '23505';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.assign_advance_payment_round() FROM PUBLIC;
CREATE TRIGGER assign_advance_payment_round
BEFORE INSERT OR UPDATE ON public.advance_payments
FOR EACH ROW EXECUTE FUNCTION public.assign_advance_payment_round();
