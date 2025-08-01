"use client";

import { CombinedSettings } from "@/app/admin/settings/interfaces";
import { createContext, useEffect, useState } from "react";

export const SettingsContext = createContext<CombinedSettings | null>(null);

export function SettingsProvider({
  children,
  settings,
}: {
  children: React.ReactNode | JSX.Element;
  settings: CombinedSettings;
}) {
  const [isMobile, setIsMobile] = useState<boolean | undefined>();

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };

    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  return (
    <SettingsContext.Provider value={{ ...settings, isMobile }}>
      {children}
    </SettingsContext.Provider>
  );
}
