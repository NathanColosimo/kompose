import type { tagIconNames } from "@kompose/api/routers/tag/contract";
import type { LucideIcon } from "lucide-react";
import {
  Bell,
  Book,
  Briefcase,
  Bug,
  Calendar,
  CheckSquare,
  ClipboardList,
  Code,
  Coffee,
  Flag,
  Flame,
  Heart,
  Home,
  Lightbulb,
  ListTodo,
  Rocket,
  Star,
  Tag,
  Target,
  Zap,
} from "lucide-react";

export type TagIconName = (typeof tagIconNames)[number];

export const tagIconMap: Record<TagIconName, LucideIcon> = {
  Bell,
  Book,
  Briefcase,
  Bug,
  Calendar,
  CheckSquare,
  ClipboardList,
  Code,
  Coffee,
  Flag,
  Flame,
  Heart,
  Home,
  Lightbulb,
  ListTodo,
  Rocket,
  Star,
  Tag,
  Target,
  Zap,
};
