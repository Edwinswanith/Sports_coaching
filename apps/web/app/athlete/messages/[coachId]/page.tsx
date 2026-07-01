"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Icon } from "../../../../components/ui";
import { AppShell } from "../../../../components/AppShell";
import { MessageThread } from "../../../../components/MessageThread";
import { athleteNav } from "../../../../lib/athleteNav";
import {
  apiFetch,
  clearSession,
  getStoredUser,
  isAuthFailure,
  logout as apiLogout,
  type StoredUser,
} from "../../../../lib/api";

export default function AthleteChatPage() {
  const router = useRouter();
  const params = useParams<{ coachId: string }>();
  const coachId = params?.coachId as string;
  const [user, setUser] = useState<StoredUser | null>(null);
  const [partyName, setPartyName] = useState<string>("");

  function authGuard(httpStatus: number): boolean {
    if (isAuthFailure(httpStatus)) {
      clearSession();
      router.replace("/");
      return true;
    }
    return false;
  }

  useEffect(() => {
    const stored = getStoredUser();
    if (!stored) {
      router.replace("/");
      return;
    }
    setUser(stored);
    // Resolve the coach's name for the header from the assigned-coaches list.
    void apiFetch("/api/athlete/coaches").then(async (res) => {
      if (authGuard(res.status)) return;
      if (!res.ok) return;
      const json = (await res.json().catch(() => ({}))) as {
        coaches?: { coachId: string; name: string }[];
      };
      const found = json.coaches?.find((c) => c.coachId === coachId);
      if (found) setPartyName(found.name);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, coachId]);

  async function logout() {
    await apiLogout();
    router.replace("/");
  }

  const nav = athleteNav();
  const navigate = (key: string) => {
    if (key === "messages") {
      router.push("/athlete/messages");
      return;
    }
    router.push(`/athlete/dashboard?section=${key}`);
  };

  if (!user) return null;

  return (
    <AppShell
      role="athlete"
      title={partyName || "Coach"}
      subtitle="Direct message"
      nav={nav}
      activeKey="messages"
      onNavigate={navigate}
      onSignOut={logout}
      headerActions={
        <button
          onClick={() => router.push("/athlete/messages")}
          aria-label="Back to messages"
          className="btn-ghost h-9 w-9 px-0"
        >
          <Icon.arrowLeft />
        </button>
      }
    >
      <MessageThread base={`/api/athlete/messages/${coachId}`} onAuthFailure={authGuard} />
    </AppShell>
  );
}
