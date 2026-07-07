import { AuthImage } from "./AuthImage";

export type AvatarInfo = { kind: "photo" | "default" | null; defaultId: string | null } | undefined;

export const AVATAR_DEFAULTS: { id: string; label: string }[] = [
  { id: "male-1", label: "Male badge 1" },
  { id: "male-2", label: "Male badge 2" },
  { id: "female-1", label: "Female badge 1" },
  { id: "female-2", label: "Female badge 2" },
];

type HairStyle = "short-side" | "buzz" | "ponytail" | "buns";

type MascotRecipe = {
  bg: string;
  skin: string;
  hair: string;
  jersey: string;
  shorts: string;
  sock: string;
  hairStyle: HairStyle;
};

const MASCOT_RECIPES: Record<string, MascotRecipe> = {
  "male-1": {
    bg: "#eff6ff",
    skin: "#f2c9a0",
    hair: "#2b2118",
    jersey: "#2563eb",
    shorts: "#ffffff",
    sock: "#2563eb",
    hairStyle: "short-side",
  },
  "male-2": {
    bg: "#f0fdf4",
    skin: "#8d5524",
    hair: "#16110c",
    jersey: "#16a34a",
    shorts: "#ffffff",
    sock: "#16a34a",
    hairStyle: "buzz",
  },
  "female-1": {
    bg: "#fdf2f8",
    skin: "#f8d9b4",
    hair: "#6b3410",
    jersey: "#db2777",
    shorts: "#ffffff",
    sock: "#db2777",
    hairStyle: "ponytail",
  },
  "female-2": {
    bg: "#f5f3ff",
    skin: "#c68642",
    hair: "#16110c",
    jersey: "#7c3aed",
    shorts: "#ffffff",
    sock: "#7c3aed",
    hairStyle: "buns",
  },
};

const BANGS_PATH = "M15 9c0-4 2-7 5-7s5 3 5 7c-1-1.5-3-2-5-2s-4 .5-5 2Z";
const BUZZ_PATH = "M15.5 8.5c0-3.5 2-6.5 4.5-6.5s4.5 3 4.5 6.5c-1-1-2.5-1.5-4.5-1.5s-3.5.5-4.5 1.5Z";

/** A small full-body athletic mascot: jersey + shorts + akimbo stance, not just a face. */
function BadgeIcon({ id, className }: { id: string; className?: string }) {
  const m = MASCOT_RECIPES[id] ?? MASCOT_RECIPES["male-1"];
  return (
    <svg
      viewBox="0 0 40 40"
      className={className}
      role="img"
      aria-label={AVATAR_DEFAULTS.find((d) => d.id === id)?.label ?? "Avatar"}
    >
      <circle cx="20" cy="20" r="20" fill={m.bg} />

      {/* arms, akimbo (hands on hips) */}
      <path d="M13 19C9 21 9 26 13 28L15 27C12 25 12 21 15 19Z" fill={m.skin} />
      <path d="M27 19C31 21 31 26 27 28L25 27C28 25 28 21 25 19Z" fill={m.skin} />

      {/* legs + shoes */}
      <rect x="15" y="33" width="3.5" height="5.5" rx="1.5" fill={m.sock} />
      <rect x="21.5" y="33" width="3.5" height="5.5" rx="1.5" fill={m.sock} />
      <ellipse cx="16.7" cy="38.3" rx="2.3" ry="1.3" fill="#1a1a1a" />
      <ellipse cx="23.3" cy="38.3" rx="2.3" ry="1.3" fill="#1a1a1a" />

      {/* shorts + jersey */}
      <rect x="14" y="28" width="12" height="6" rx="2" fill={m.shorts} />
      <rect x="13" y="18" width="14" height="11" rx="4" fill={m.jersey} />
      <circle cx="20" cy="22" r="2" fill="#fff" fillOpacity={0.95} />
      <circle cx="20" cy="22" r="1" fill={m.jersey} />

      {/* neck + head */}
      <rect x="18" y="15" width="4" height="3" fill={m.skin} />
      <circle cx="20" cy="11" r="5" fill={m.skin} />

      {/* hairstyle */}
      {m.hairStyle === "buzz" ? <path d={BUZZ_PATH} fill={m.hair} /> : <path d={BANGS_PATH} fill={m.hair} />}
      {m.hairStyle === "ponytail" ? <ellipse cx="26.5" cy="12" rx="1.8" ry="3.2" fill={m.hair} /> : null}
      {m.hairStyle === "buns" ? (
        <>
          <circle cx="15.5" cy="6.5" r="2" fill={m.hair} />
          <circle cx="24.5" cy="6.5" r="2" fill={m.hair} />
        </>
      ) : null}

      <circle cx="18" cy="11" r="0.7" fill="#2b2118" />
      <circle cx="22" cy="11" r="0.7" fill="#2b2118" />
    </svg>
  );
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Renders a user's profile picture: an uploaded photo, a bundled badge icon,
 * or an initials fallback when neither is set — same precedence as the
 * server's `avatarSummary()`.
 */
export function Avatar({
  avatar,
  name,
  className = "h-9 w-9",
  photoPath = "/api/me/avatar/file",
}: {
  avatar: AvatarInfo;
  name: string;
  className?: string;
  /** Override to view another user's photo, e.g. a coach viewing an assigned athlete's avatar. */
  photoPath?: string;
}) {
  if (avatar?.kind === "photo") {
    return (
      <AuthImage
        src={photoPath}
        alt={`${name}'s profile photo`}
        className={`${className} shrink-0 rounded-full object-cover`}
      />
    );
  }
  if (avatar?.kind === "default" && avatar.defaultId) {
    return <BadgeIcon id={avatar.defaultId} className={`${className} shrink-0 rounded-full`} />;
  }
  return (
    <span
      className={`${className} flex shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-bold text-accent-strong`}
    >
      {initialsOf(name)}
    </span>
  );
}

export function AvatarBadgePicker({
  selectedId,
  onSelect,
}: {
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-3">
      {AVATAR_DEFAULTS.map((d) => (
        <button
          key={d.id}
          type="button"
          onClick={() => onSelect(d.id)}
          aria-pressed={selectedId === d.id}
          className={`rounded-full p-0.5 transition ${
            selectedId === d.id ? "ring-2 ring-accent ring-offset-2 ring-offset-surface" : "hover:opacity-80"
          }`}
        >
          <BadgeIcon id={d.id} className="h-12 w-12" />
        </button>
      ))}
    </div>
  );
}
