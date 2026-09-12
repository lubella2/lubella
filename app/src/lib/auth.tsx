/**
 * Authentication and role context.
 *
 * The role here drives navigation and which controls are rendered — that is
 * Layer 1 of the three-layer model (§52). It is NOT the security boundary:
 * every screen's data still comes from PostgreSQL under the caller's own token,
 * so switching a value in this file (or in devtools) reveals nothing, it merely
 * produces an interface full of permission errors.
 */
import {
  createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode,
} from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import type { AppUser, UserRole } from '../types';

interface AuthState {
  session: Session | null;
  profile: AppUser | null;
  role: UserRole | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<AppUser>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
  isOwner: boolean;
  isStaff: boolean;
  isSupplier: boolean;
  isInternal: boolean;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(async (activeSession: Session | null) => {
    if (!activeSession) {
      setProfile(null);
      return;
    }
    // RLS lets a signed-in user read exactly their own app_users row.
    const { data, error } = await supabase
      .from('app_users')
      .select('id,email,full_name,phone,role,active,commission_rate,last_login_at')
      .eq('id', activeSession.user.id)
      .maybeSingle();

    if (error || !data) {
      setProfile(null);
      return;
    }
    setProfile(data as AppUser);
  }, []);

  useEffect(() => {
    let cancelled = false;

    supabase.auth.getSession().then(async ({ data }) => {
      if (cancelled) return;
      setSession(data.session);
      await loadProfile(data.session);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, nextSession) => {
      if (cancelled) return;
      setSession(nextSession);
      await loadProfile(nextSession);
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [loadProfile]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      throw new Error(
        /invalid/i.test(error.message)
          ? 'Those details did not match an account. Please check and try again.'
          : error.message,
      );
    }
    const { data: row, error: profileError } = await supabase
      .from('app_users')
      .select('id,email,full_name,phone,role,active,commission_rate,last_login_at')
      .eq('id', data.user.id)
      .maybeSingle();

    if (profileError || !row) {
      await supabase.auth.signOut();
      throw new Error('This login is not linked to a LuBella profile. Please contact the shop owner.');
    }
    const nextProfile = row as AppUser;
    setSession(data.session);
    setProfile(nextProfile);
    return nextProfile;
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setSession(null);
    setProfile(null);
  }, []);

  const refresh = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    setSession(data.session);
    await loadProfile(data.session);
  }, [loadProfile]);

  const value = useMemo<AuthState>(() => ({
    session,
    profile,
    role: profile?.role ?? null,
    loading,
    signIn,
    signOut,
    refresh,
    isOwner: profile?.role === 'OWNER',
    isStaff: profile?.role === 'STAFF',
    isSupplier: profile?.role === 'SUPPLIER',
    isInternal: profile?.role === 'OWNER' || profile?.role === 'STAFF',
  }), [session, profile, loading, signIn, signOut, refresh]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/** Where each role belongs after signing in. */
export function homeForRole(role: UserRole | null | undefined): string {
  switch (role) {
    case 'OWNER': return '/admin';
    case 'STAFF': return '/staff';
    case 'SUPPLIER': return '/supplier';
    default: return '/';
  }
}
