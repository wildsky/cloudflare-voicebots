// Database service for user data management
import { logger } from "@/utils";

export interface User {
  id?: number;
  guid?: string;
  dateAdded?: string;
  phone?: number;
  fName?: string;
  lName?: string;
  biography?: string;
  primaryUserID?: number;
  primaryUserRelationship?: string;
  temperature?: number;
}

export class DatabaseService {
  private db: D1Database;

  constructor(database: D1Database) {
    this.db = database;
  }

  /**
   * Find user by phone number
   */
  async getUserByPhone(phone: number): Promise<User | null> {
    try {
      const result = await this.db
        .prepare("SELECT * FROM users WHERE phone = ?")
        .bind(phone)
        .first<User>();

      logger.debug("Found user by phone", { phone, user: result });
      return result || null;
    } catch (error) {
      logger.error("Error finding user by phone", { phone, error });
      throw error;
    }
  }

  /**
   * Get user data from phone number in From field (for cross-instance access)
   */
  async getUserDataFromTwilioNumber(twilioFromNumber: string): Promise<User | null> {
    try {
      // Extract the numeric phone number from Twilio format (+15551234567)
      const numericPhone = parseInt(twilioFromNumber.replace(/[^\d]/g, ''));
      
      if (isNaN(numericPhone)) {
        logger.warn("Invalid phone number format", { twilioFromNumber });
        return null;
      }

      return await this.getUserByPhone(numericPhone);
    } catch (error) {
      logger.error("Error getting user data from Twilio number", { 
        twilioFromNumber, 
        error: error?.message || error?.toString() || 'Unknown error',
        errorType: error?.constructor?.name || 'Unknown type'
      });
      return null;
    }
  }

  /**
   * Find user by GUID
   */
  async getUserByGuid(guid: string): Promise<User | null> {
    try {
      const result = await this.db
        .prepare("SELECT * FROM users WHERE guid = ?")
        .bind(guid)
        .first<User>();

      logger.debug("Found user by GUID", { guid, user: result });
      return result || null;
    } catch (error) {
      logger.error("Error finding user by GUID", { guid, error });
      throw error;
    }
  }

  /**
   * Find user by name
   */
  async getUserByName(firstName?: string, lastName?: string): Promise<User[]> {
    try {
      let query = "SELECT * FROM users WHERE 1=1";
      const params: any[] = [];

      if (firstName) {
        query += " AND fName LIKE ?";
        params.push(`%${firstName}%`);
      }

      if (lastName) {
        query += " AND lName LIKE ?";
        params.push(`%${lastName}%`);
      }

      const result = await this.db
        .prepare(query)
        .bind(...params)
        .all<User>();

      logger.debug("Found users by name", {
        firstName,
        lastName,
        count: result.results?.length,
      });
      return result.results || [];
    } catch (error) {
      logger.error("Error finding user by name", {
        firstName,
        lastName,
        error,
      });
      throw error;
    }
  }

  /**
   * Create or update user
   */
  async upsertUser(user: User): Promise<User> {
    try {
      if (user.id) {
        // Update existing user
        await this.db
          .prepare(
            `
            UPDATE users 
            SET guid = ?, phone = ?, fName = ?, lName = ?, biography = ?, 
                primaryUserID = ?, primaryUserRelationship = ?, temperature = ?
            WHERE id = ?
          `
          )
          .bind(
            user.guid,
            user.phone,
            user.fName,
            user.lName,
            user.biography,
            user.primaryUserID,
            user.primaryUserRelationship,
            user.temperature,
            user.id
          )
          .run();

        logger.debug("Updated user", { userId: user.id });
        return user;
      } else {
        // Create new user
        const result = await this.db
          .prepare(
            `
            INSERT INTO users (guid, phone, fName, lName, biography, primaryUserID, primaryUserRelationship, temperature)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `
          )
          .bind(
            user.guid,
            user.phone,
            user.fName,
            user.lName,
            user.biography,
            user.primaryUserID,
            user.primaryUserRelationship,
            user.temperature || 0.7
          )
          .run();

        const newUser = { ...user, id: result.meta.last_row_id as number };
        logger.debug("Created new user", { userId: newUser.id });
        return newUser;
      }
    } catch (error) {
      logger.error("Error upserting user", { user, error });
      throw error;
    }
  }

  /**
   * Get all users (with optional limit)
   */
  async getUsers(limit: number = 50): Promise<User[]> {
    try {
      const result = await this.db
        .prepare("SELECT * FROM users ORDER BY dateAdded DESC LIMIT ?")
        .bind(limit)
        .all<User>();

      logger.debug("Retrieved users", { count: result.results?.length });
      return result.results || [];
    } catch (error) {
      logger.error("Error retrieving users", { error });
      throw error;
    }
  }
}
