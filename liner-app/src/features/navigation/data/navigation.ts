import type { ComponentType } from "react";
import {
  Home7Fill,
  Search3Fill,
  BookmarksFill,
  Folder2Fill,
  HistoryLine,
  Settings4Fill,
} from "@mingcute/react";
import { LuDownload } from "react-icons/lu";

export interface NavItem {
  id: string;
  label: string;
  href?: string;
  Icon: ComponentType<{ size?: number; className?: string }>;
}

export const sidebarNavItems: NavItem[] = [
  { id: "home", label: "Home", href: "/", Icon: Home7Fill },
  { id: "search", label: "Search", Icon: Search3Fill },
  { id: "library", label: "Library", href: "/library", Icon: BookmarksFill },
  { id: "local", label: "Local Music", href: "/local", Icon: Folder2Fill },
  { id: "downloads", label: "Downloads", href: "/downloads", Icon: LuDownload },
  { id: "changelog", label: "Changelog", Icon: HistoryLine },
  { id: "settings", label: "Settings", Icon: Settings4Fill },
];
