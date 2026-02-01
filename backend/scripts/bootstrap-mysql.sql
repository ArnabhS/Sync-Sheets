-- Optional: bootstrap database and example table for sync.
-- Run: mysql -u root -p < scripts/bootstrap-mysql.sql

CREATE DATABASE IF NOT EXISTS sheets_sync;
USE sheets_sync;

-- Example table: first column = id (unique row key). _sync_updated_at is added by the app if missing.
CREATE TABLE IF NOT EXISTS sales_data (
  id INT PRIMARY KEY AUTO_INCREMENT,
  product VARCHAR(255),
  quantity INT,
  amount DECIMAL(10,2),
  _sync_updated_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
);

-- Grant (adjust user/host as needed):
-- GRANT ALL ON sheets_sync.* TO 'your_user'@'localhost';
