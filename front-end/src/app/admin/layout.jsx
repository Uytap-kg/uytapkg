"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import { getMe } from "@/utils/api";
import LoadingScreen from "@/components/ui/loadingScreen/LoadingScreen";

// Единая точка входа для /admin/**. НЕ является настоящей защитой —
// это только UX-редирект, чтобы посторонний не видел вёрстку админки.
// Реальная граница безопасности — requireAdmin на бэкенде для каждого
// /api/admin/* эндпоинта: даже если кто-то обойдёт этот layout, сами
// данные всё равно не отдадутся без токена админа.
function clearSession() {
  localStorage.removeItem("uytap_token");
  localStorage.removeItem("uytap_user");
  document.cookie = "uytap_token=; path=/; max-age=0";
}

export default function AdminLayout({ children }) {
  const pathname = usePathname();
  const router = useRouter();
  const isLoginPage = pathname === "/admin/login";

  const [checking, setChecking] = useState(!isLoginPage);
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    if (isLoginPage) return;

    let cancelled = false;

    const check = async () => {
      const token = localStorage.getItem("uytap_token");

      if (!token) {
        router.replace("/admin/login");
        return;
      }

      try {
        const user = await getMe(token);

        if (cancelled) return;

        if (user?.role !== "admin") {
          // Do NOT clear session - user is validly logged in, just not an admin
          router.replace("/");
          return;
        }

        setAllowed(true);
      } catch {
        if (cancelled) return;

        router.replace("/admin/login");
      } finally {
        if (!cancelled) setChecking(false);
      }
    };

    check();

    return () => {
      cancelled = true;
    };
  }, [isLoginPage, router]);

  if (isLoginPage) return children;

  if (checking || !allowed) return <LoadingScreen />;

  return children;
}
