import {
  AlarmClock, BarChart3, Bell, BookOpen, Bot, Building, Building2, CalendarDays, CheckSquare, ClipboardList, Clock,
  Database, Factory, Fingerprint, Inbox, KeyRound, LayoutDashboard, Library, Network, Phone, Plane, Plus, ScanFace,
  Settings, ShieldCheck, UserCircle, Users, UsersRound, Wallet, type LucideIcon,
} from "lucide-react";

/**
 * The layouts name a nav item's icon with a short code (an emoji, kept so
 * no layout had to change); the shell draws the matching line icon.
 */
const ICONS: Record<string, LucideIcon> = {
  "▣": LayoutDashboard, "👥": Users, "🔑": KeyRound, "🗂️": Network, "🗂": Network, "📞": Phone, "📥": Inbox,
  "🗒️": ClipboardList, "🕒": Clock, "👫": UsersRound, "📊": BarChart3, "⚙️": Settings, "📟": Fingerprint,
  "🙂": ScanFace, "📅": CalendarDays, "⏰": AlarmClock, "🏖️": Plane, "🤖": Bot, "✅": CheckSquare, "💼": Wallet,
  "📒": BookOpen, "🗃️": Database, "📚": Library, "🛡️": ShieldCheck, "👤": UserCircle, "＋": Plus, "🏭": Factory,
  "🏬": Building, "🏢": Building2, "🔔": Bell,
};

export function NavIcon({ code, className = "h-[18px] w-[18px]" }: { code: string; className?: string }) {
  const Icon = ICONS[code];
  if (!Icon) return <span className="inline-flex w-[18px] justify-center text-sm" aria-hidden>{code}</span>;
  return <Icon className={className} strokeWidth={1.75} aria-hidden />;
}
