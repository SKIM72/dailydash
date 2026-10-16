-- 오프라인 입력 중복 방지: 휴대폰이 붙인 고유 번호. 같은 번호로 다시 보내면 새로 저장하지 않는다.
ALTER TABLE transactions ADD COLUMN client_id UUID UNIQUE;
