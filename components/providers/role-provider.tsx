"use client";

import { createContext, useContext } from "react";

/**
 * Whether the signed-in member is on the Sales team, for hiding money and admin menus in the UI.
 * The server is the real boundary: money never reaches a Sales member's browser in the first place.
 */
const RoleContext = createContext({ isSales: false });

export function RoleProvider({ isSales, children }: { isSales: boolean; children: React.ReactNode }) {
  return <RoleContext.Provider value={{ isSales }}>{children}</RoleContext.Provider>;
}

export const useIsSales = () => useContext(RoleContext).isSales;
