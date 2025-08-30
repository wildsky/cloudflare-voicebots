-- User table schema for Cloudflare D1 (SQLite)
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guid TEXT,
    dateAdded TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    phone INTEGER,
    fName TEXT,
    lName TEXT,
    biography TEXT,
    primaryUserID INTEGER,
    primaryUserRelationship TEXT,
    temperature REAL DEFAULT 0.70
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_users_guid ON users(guid);
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
CREATE INDEX IF NOT EXISTS idx_users_primary ON users(primaryUserID);