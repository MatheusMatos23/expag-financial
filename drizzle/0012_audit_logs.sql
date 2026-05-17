CREATE TABLE IF NOT EXISTS audit_logs (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  userId      INT NULL,
  userName    VARCHAR(200) NULL,
  userEmail   VARCHAR(200) NULL,
  action      VARCHAR(80) NOT NULL,
  category    VARCHAR(50) NOT NULL,
  entityType  VARCHAR(50) NULL,
  entityId    VARCHAR(100) NULL,
  summary     TEXT NOT NULL,
  metadata    TEXT NULL,
  ipAddress   VARCHAR(60) NULL,
  createdAt   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX audit_category_idx ON audit_logs (category, createdAt);
CREATE INDEX audit_user_idx ON audit_logs (userId, createdAt);
CREATE INDEX audit_created_idx ON audit_logs (createdAt);
