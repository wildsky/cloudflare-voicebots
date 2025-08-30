# Database Setup Instructions

This guide will help you set up the Cloudflare D1 database for user data storage.

## Step 1: Create the D1 Database

Run this command to create a new D1 database:

```bash
npx wrangler d1 create voicebot-users
```

This will output something like:
```
✅ Successfully created DB 'voicebot-users' in region UNKNOWN
Created your database using D1's new storage backend!

[[d1_databases]]
binding = "DB" # i.e. available in your Worker on env.DB
database_name = "voicebot-users"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

## Step 2: Update Wrangler Configuration

Copy the `database_id` from the output above and replace the "placeholder" value in `wrangler.jsonc`:

```json
"d1_databases": [
  {
    "binding": "USER_DB",
    "database_name": "voicebot-users",
    "database_id": "your-actual-database-id-here"
  }
]
```

## Step 3: Initialize the Database Schema

Run this command to create the tables:

```bash
npx wrangler d1 execute voicebot-users --file=./src/services/database/schema.sql
```

## Step 4: (Optional) Add Sample Data

To add some test data, you can run:

```bash
npx wrangler d1 execute voicebot-users --command="
INSERT INTO users (guid, phone, fName, lName, biography, temperature) 
VALUES 
  ('user-123', 5551234567, 'John', 'Doe', 'Software developer who loves AI', 0.7),
  ('user-456', 5559876543, 'Jane', 'Smith', 'Designer and voice interface enthusiast', 0.8);
"
```

## Step 5: Deploy

Once the database is set up and configured, deploy your changes:

```bash
npm run deploy
```

## Available Database Functions

The voice agent now has access to these database tools:

- **findUserByPhone**: Find a user by their phone number
- **findUserByName**: Find users by first name, last name, or both  
- **getUserProfile**: Get detailed profile information by user GUID
- **updateUserInfo**: Update user information like biography, name, or AI temperature
- **listRecentUsers**: Get a list of recent users

## Example Voice Commands

Once set up, users can ask things like:
- "Do you know anything about me?"
- "What's my temperature setting?"  
- "Update my biography to say I'm a musician"
- "Find the user named John"
- "Who are the recent users?"

The AI will use these database tools to provide personalized responses!