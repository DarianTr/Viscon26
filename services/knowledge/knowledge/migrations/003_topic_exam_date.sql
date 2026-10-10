-- When each topic is examined. Until exams are split into topics, a topic is a
-- whole subject with its own exam date; the timeline forecasts each topic for it.
alter table topics add column exam_date date;
