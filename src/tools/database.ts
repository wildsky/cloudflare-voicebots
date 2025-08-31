// Database tools for AI agent to query user information
import { tool } from "ai";
import { z } from "zod";
import { DatabaseService, type User } from "@/services/database/database";
import { logger } from "@/utils";

// Database service instance (will be set by the agent)
let dbService: DatabaseService | null = null;

export function initializeDatabaseTools(database: D1Database) {
  dbService = new DatabaseService(database);
}

export const findUserByPhone = tool({
  description: "Find a user by their phone number",
  parameters: z.object({
    phone: z.number().describe("The phone number to search for"),
  }),
  execute: async ({ phone }) => {
    if (!dbService) {
      throw new Error("Database service not initialized");
    }

    try {
      const user = await dbService.getUserByPhone(phone);
      if (!user) {
        return {
          success: false,
          message: "No user found with that phone number",
        };
      }

      return {
        success: true,
        user: {
          name: `${user.fName || ""} ${user.lName || ""}`.trim(),
          phone: user.phone,
          biography: user.biography,
          temperature: user.temperature,
          relationship: user.primaryUserRelationship,
          dateAdded: user.dateAdded,
        },
      };
    } catch (error) {
      logger.error("Error in findUserByPhone tool", { phone, error });
      return { success: false, message: "Error searching for user" };
    }
  },
});

export const findUserByName = tool({
  description: "Find users by their first name, last name, or both",
  parameters: z.object({
    firstName: z.string().optional().describe("First name to search for"),
    lastName: z.string().optional().describe("Last name to search for"),
  }),
  execute: async ({ firstName, lastName }) => {
    if (!dbService) {
      throw new Error("Database service not initialized");
    }

    try {
      const users = await dbService.getUserByName(firstName, lastName);
      if (users.length === 0) {
        return { success: false, message: "No users found with that name" };
      }

      return {
        success: true,
        users: users.map((user) => ({
          name: `${user.fName || ""} ${user.lName || ""}`.trim(),
          phone: user.phone,
          biography: user.biography,
          temperature: user.temperature,
          relationship: user.primaryUserRelationship,
          dateAdded: user.dateAdded,
        })),
      };
    } catch (error) {
      logger.error("Error in findUserByName tool", {
        firstName,
        lastName,
        error,
      });
      return { success: false, message: "Error searching for users" };
    }
  },
});

export const getUserProfile = tool({
  description: "Get detailed profile information for a user by their GUID",
  parameters: z.object({
    guid: z.string().describe("The user's unique GUID identifier"),
  }),
  execute: async ({ guid }) => {
    if (!dbService) {
      throw new Error("Database service not initialized");
    }

    try {
      const user = await dbService.getUserByGuid(guid);
      if (!user) {
        return { success: false, message: "No user found with that ID" };
      }

      return {
        success: true,
        profile: {
          id: user.guid,
          name: `${user.fName || ""} ${user.lName || ""}`.trim(),
          phone: user.phone,
          biography: user.biography,
          temperature: user.temperature,
          primaryUser: user.primaryUserID,
          relationship: user.primaryUserRelationship,
          memberSince: user.dateAdded,
        },
      };
    } catch (error) {
      logger.error("Error in getUserProfile tool", { guid, error });
      return { success: false, message: "Error retrieving user profile" };
    }
  },
});

export const updateUserInfo = tool({
  description:
    "Update user information like biography, name, or AI temperature preference",
  parameters: z.object({
    guid: z.string().describe("The user's unique GUID identifier"),
    firstName: z.string().optional().describe("Updated first name"),
    lastName: z.string().optional().describe("Updated last name"),
    biography: z.string().optional().describe("Updated biography/description"),
    temperature: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe("AI temperature preference (0-1)"),
    relationship: z
      .string()
      .optional()
      .describe("Relationship to primary user"),
  }),
  execute: async ({
    guid,
    firstName,
    lastName,
    biography,
    temperature,
    relationship,
  }) => {
    if (!dbService) {
      throw new Error("Database service not initialized");
    }

    try {
      // First get the existing user
      const existingUser = await dbService.getUserByGuid(guid);
      if (!existingUser) {
        return { success: false, message: "No user found with that ID" };
      }

      // Update with new values
      const updatedUser = {
        ...existingUser,
        fName: firstName ?? existingUser.fName,
        lName: lastName ?? existingUser.lName,
        biography: biography ?? existingUser.biography,
        temperature: temperature ?? existingUser.temperature,
        primaryUserRelationship:
          relationship ?? existingUser.primaryUserRelationship,
      };

      await dbService.upsertUser(updatedUser);

      return {
        success: true,
        message: "User information updated successfully",
        updatedFields: {
          ...(firstName && { firstName }),
          ...(lastName && { lastName }),
          ...(biography && { biography }),
          ...(temperature && { temperature }),
          ...(relationship && { relationship }),
        },
      };
    } catch (error) {
      logger.error("Error in updateUserInfo tool", { guid, error });
      return { success: false, message: "Error updating user information" };
    }
  },
});

export const listRecentUsers = tool({
  description:
    "Get a list of recent users (useful for admin/overview purposes)",
  parameters: z.object({
    limit: z
      .number()
      .min(1)
      .max(100)
      .default(10)
      .describe("Maximum number of users to return"),
  }),
  execute: async ({ limit }) => {
    if (!dbService) {
      throw new Error("Database service not initialized");
    }

    try {
      const users = await dbService.getUsers(limit);

      return {
        success: true,
        users: users.map((user) => ({
          id: user.guid,
          name: `${user.fName || ""} ${user.lName || ""}`.trim(),
          phone: user.phone,
          relationship: user.primaryUserRelationship,
          dateAdded: user.dateAdded,
        })),
      };
    } catch (error) {
      logger.error("Error in listRecentUsers tool", { limit, error });
      return { success: false, message: "Error retrieving user list" };
    }
  },
});
