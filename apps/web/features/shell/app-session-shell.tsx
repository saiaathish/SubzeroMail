"use client";

import {
  Check,
  ChevronDown,
  LogOut,
  Moon,
  ShieldCheck,
  Sun,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { InboxWorkspace } from "@/features/inbox/inbox-workspace";
import { clearCachedThreads } from "@/lib/cache";

type ThemePreset = "light" | "dark";
type SessionProfile = {
  email: string;
  name: string;
  picture: string | null;
};
type SessionPayload = {
  authenticated: boolean;
  profile: SessionProfile | null;
};

const THEME_STORAGE_KEY = "subzero-theme";

export function AppSessionShell() {
  const demoMode = process.env.NEXT_PUBLIC_SUBZERO_DEMO_MODE === "true";
  const [sessionState, setSessionState] = useState<
    "loading" | "authenticated" | "signed-out"
  >("loading");
  const [profile, setProfile] = useState<SessionProfile | null>(null);
  const [theme, setTheme] = useState<ThemePreset>("light");
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    const initial: ThemePreset =
      stored === "dark" || stored === "light"
        ? stored
        : window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light";
    applyTheme(initial);
    setTheme(initial);
  }, []);

  useEffect(() => {
    if (demoMode) {
      setSessionState("authenticated");
      setProfile({
        email: "you@example.com",
        name: "Subzero Demo",
        picture: null,
      });
      return;
    }

    let active = true;
    void fetch("/api/auth/session", { credentials: "same-origin" })
      .then(async (response) => {
        const payload = (await response.json()) as SessionPayload;
        if (!active) return;
        if (response.ok && payload.authenticated && payload.profile) {
          setProfile(payload.profile);
          setSessionState("authenticated");
        } else {
          setProfile(null);
          setSessionState("signed-out");
        }
      })
      .catch(() => {
        if (!active) return;
        setProfile(null);
        setSessionState("signed-out");
      });

    return () => {
      active = false;
    };
  }, [demoMode]);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  const initials = useMemo(() => {
    const source = profile?.name || profile?.email || "SZ";
    return source
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("");
  }, [profile]);

  const setThemePreset = (preset: ThemePreset) => {
    window.localStorage.setItem(THEME_STORAGE_KEY, preset);
    applyTheme(preset);
    setTheme(preset);
  };

  const signIn = () => {
    window.location.assign("/api/auth/google");
  };

  const signOut = async () => {
    setMenuOpen(false);
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin",
      });
    } finally {
      await clearCachedThreads().catch(() => undefined);
      setProfile(null);
      setSessionState("signed-out");
    }
  };

  if (demoMode) return <InboxWorkspace />;

  if (sessionState === "loading") {
    return (
      <main className="auth-gate" aria-label="Loading Subzero Mail">
        <div className="auth-gate-card auth-gate-loading">
          <BrandLockup />
          <div className="auth-loading-line" />
          <p>Restoring your encrypted local Gmail session…</p>
        </div>
      </main>
    );
  }

  if (sessionState === "signed-out") {
    return (
      <main className="auth-gate" aria-label="Sign in to Subzero Mail">
        <section className="auth-gate-card">
          <BrandLockup />
          <div className="auth-gate-copy">
            <h1>Your inbox, without the subscription.</h1>
            <p>
              Sign in with Google to open Subzero. Gmail remains the source of
              truth, your refresh token is encrypted locally, and your session
              is remembered on this device.
            </p>
          </div>
          <button
            className="google-signin-button"
            data-testid="connect-gmail"
            onClick={signIn}
          >
            <GoogleMark />
            Continue with Google
          </button>
          <div className="auth-trust-row">
            <ShieldCheck size={15} aria-hidden="true" />
            <span>Google OAuth · Gmail API · local encrypted credentials</span>
          </div>
        </section>
      </main>
    );
  }

  return (
    <div className="authenticated-shell">
      <InboxWorkspace />
      <div className="account-dock" ref={menuRef}>
        {menuOpen ? (
          <section
            className="account-popover"
            role="dialog"
            aria-label="Google account and appearance"
          >
            <div className="account-popover-profile">
              <Avatar profile={profile} initials={initials} large />
              <div>
                <strong>{profile?.name ?? "Google user"}</strong>
                <span>{profile?.email ?? ""}</span>
              </div>
            </div>

            <div className="account-popover-section">
              <span className="account-popover-label">Appearance</span>
              <div className="theme-presets" role="group" aria-label="Theme">
                <button
                  className={theme === "light" ? "active" : ""}
                  aria-pressed={theme === "light"}
                  onClick={() => setThemePreset("light")}
                >
                  <Sun size={14} /> Light
                  {theme === "light" ? <Check size={13} /> : null}
                </button>
                <button
                  className={theme === "dark" ? "active" : ""}
                  aria-pressed={theme === "dark"}
                  onClick={() => setThemePreset("dark")}
                >
                  <Moon size={14} /> Dark
                  {theme === "dark" ? <Check size={13} /> : null}
                </button>
              </div>
            </div>

            <button className="account-signout" onClick={() => void signOut()}>
              <LogOut size={15} /> Sign out
            </button>
          </section>
        ) : null}

        <button
          className="account-trigger"
          data-testid="account-menu"
          aria-haspopup="dialog"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((current) => !current)}
        >
          <Avatar profile={profile} initials={initials} />
          <span className="account-trigger-copy">
            <strong>{profile?.name ?? "Google user"}</strong>
            <small>{profile?.email ?? ""}</small>
          </span>
          <ChevronDown size={15} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

function applyTheme(theme: ThemePreset) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

function BrandLockup() {
  return (
    <div className="auth-brand">
      <span className="auth-brand-mark">✦</span>
      <span>
        SUBZERO
        <small>MAIL / BYOK</small>
      </span>
    </div>
  );
}

function Avatar({
  profile,
  initials,
  large = false,
}: {
  profile: SessionProfile | null;
  initials: string;
  large?: boolean;
}) {
  if (profile?.picture) {
    return (
      <img
        className={`account-avatar${large ? " large" : ""}`}
        src={profile.picture}
        alt=""
        referrerPolicy="no-referrer"
      />
    );
  }
  return (
    <span className={`account-avatar fallback${large ? " large" : ""}`}>
      {initials || "SZ"}
    </span>
  );
}

function GoogleMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18">
      <path
        fill="#4285F4"
        d="M21.6 12.23c0-.71-.06-1.4-.18-2.07H12v3.92h5.38a4.6 4.6 0 0 1-2 3.02v2.54h3.24c1.9-1.75 2.98-4.33 2.98-7.41Z"
      />
      <path
        fill="#34A853"
        d="M12 22c2.7 0 4.98-.9 6.64-2.43L15.4 17.1c-.9.6-2.05.96-3.4.96-2.61 0-4.82-1.76-5.61-4.13H3.04v2.62A10 10 0 0 0 12 22Z"
      />
      <path
        fill="#FBBC05"
        d="M6.39 13.93A6.02 6.02 0 0 1 6.07 12c0-.67.12-1.32.32-1.93V7.45H3.04A10 10 0 0 0 2 12c0 1.61.39 3.14 1.04 4.55l3.35-2.62Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.94c1.47 0 2.79.51 3.83 1.5l2.88-2.88A9.64 9.64 0 0 0 12 2a10 10 0 0 0-8.96 5.45l3.35 2.62C7.18 7.7 9.39 5.94 12 5.94Z"
      />
    </svg>
  );
}
