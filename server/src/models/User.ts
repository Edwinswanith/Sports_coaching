import { Schema, model, Types, type InferSchemaType, type Model } from "mongoose";

export const USER_ROLES = ["coach", "athlete", "guardian"] as const;
export type UserRole = (typeof USER_ROLES)[number];

const userSchema = new Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: USER_ROLES, required: true, index: true },
    name: { type: String, required: true, trim: true },
    phone: { type: String, trim: true },
    isActive: { type: Boolean, default: true },
    // Scoped coach capability (NOT an admin role): an "academy owner" is a coach
    // who can also create/list other coaches in their academy. See CLAUDE.md.
    isAcademyOwner: { type: Boolean, default: false },
    // Set when a coach provisions the account with a temp password — the user is
    // nudged to set their own password on first sign-in. Cleared on change.
    mustChangePassword: { type: Boolean, default: false },
    refreshTokenHash: { type: String },
    academyId: { type: Schema.Types.ObjectId, ref: "Academy", index: true },
  },
  { timestamps: true }
);

userSchema.set("toJSON", {
  transform: (_doc, ret) => {
    delete (ret as Record<string, unknown>).passwordHash;
    delete (ret as Record<string, unknown>).refreshTokenHash;
    return ret;
  },
});

export type UserDoc = InferSchemaType<typeof userSchema> & { _id: Types.ObjectId };
export const User: Model<UserDoc> = model<UserDoc>("User", userSchema);
