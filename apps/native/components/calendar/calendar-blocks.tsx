import type { Event as GoogleEvent } from "@kompose/google-cal/schema";
import { extractMeetingLink } from "@kompose/state/meeting";
import { formatTimeRange } from "@kompose/state/temporal-utils";
import type { LucideIcon } from "lucide-react-native";
import { Check, MapPin, Video } from "lucide-react-native";
import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import type { Temporal } from "temporal-polyfill";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { mixColor } from "@/lib/color-mix";
import { useColorScheme } from "@/lib/color-scheme-context";
import { THEME } from "@/lib/theme";

/** Blocks shorter than this show only their title. */
const TITLE_ONLY_MINUTES = 45;
/** Blocks at least this long also list their details. */
const DETAILS_MINUTES = 60;
/** Blocks at least this long let the title wrap to two lines. */
const TWO_LINE_TITLE_MINUTES = 90;
/** Blocks shorter than this center one line with no vertical padding. */
const COMPACT_MINUTES = 30;

export interface BlockDetail {
  icon: LucideIcon;
  label: string;
  /** A value kept beside the title or time in short blocks, such as strain. */
  short?: string;
}

/** Title, time, and details as one sentence for VoiceOver. */
function describeBlock(
  title: string,
  start: Temporal.ZonedDateTime,
  end: Temporal.ZonedDateTime,
  details: BlockDetail[] = []
): string {
  return [
    title,
    formatTimeRange(start, end),
    ...details.map((d) => d.label),
  ].join(", ");
}

/** The meeting provider, or else the place, for an event's detail line. */
export function eventDetails(event: GoogleEvent): BlockDetail[] {
  const meeting = extractMeetingLink(event);
  if (meeting) {
    return [{ icon: Video, label: meeting.label }];
  }
  const place = event.location?.trim();
  return place ? [{ icon: MapPin, label: place }] : [];
}

interface BlockPosition {
  /** Width of the day's block area in points, less the create strip. */
  areaWidth: number;
  columnIndex?: number;
  columnSpan?: number;
  height: number;
  /**
   * Long press, with the pressed point in points from the top of the day.
   * The calendar offers the block's actions and creating at that time.
   */
  onLongPressAt?: (offsetY: number) => void;
  /** Indent level from the collision layout; see ItemLayout.stackDepth. */
  stackDepth?: number;
  top: number;
  totalColumns?: number;
  zIndex?: number;
}

/** Points per indent level, so the items underneath keep an edge in view. */
const STACK_INDENT_PT = 8;
/** Deeper levels stop indenting, so a block never gets too narrow to read. */
const MAX_STACK_INDENT_LEVELS = 3;

/**
 * Shared collision layout (packages/state/src/collision-utils.ts) in points:
 * indent by the level, then split the rest into the group's columns.
 */
function positionStyle({
  areaWidth,
  columnIndex = 0,
  columnSpan = 1,
  height,
  stackDepth = 0,
  top,
  totalColumns = 1,
  zIndex = 1,
}: BlockPosition) {
  const indent =
    Math.min(stackDepth, MAX_STACK_INDENT_LEVELS) * STACK_INDENT_PT;
  const rest = Math.max(areaWidth - indent, 0);
  return {
    height,
    left: indent + (rest * columnIndex) / totalColumns,
    top,
    width: (rest * columnSpan) / totalColumns,
    zIndex,
  };
}

interface BlockTextProps {
  details?: BlockDetail[];
  end: Temporal.ZonedDateTime;
  /** Visible minutes, which set how much text fits. */
  minutes: number;
  /**
   * Too narrow for the time (side by side on a busy day): the title takes
   * its lines instead. There's no hover on a phone, so the title matters most.
   */
  narrow?: boolean;
  start: Temporal.ZonedDateTime;
  struck?: boolean;
  title: string;
}

/** Narrower than this, a block shows its title in place of the time. */
const NARROW_BLOCK_PT = 72;

/** Title lines that fit: more for a narrow block, which drops its time line. */
function titleLines(minutes: number, narrow: boolean): number {
  if (narrow) {
    if (minutes >= DETAILS_MINUTES) {
      return 3;
    }
    return minutes >= TITLE_ONLY_MINUTES ? 2 : 1;
  }
  return minutes >= TWO_LINE_TITLE_MINUTES ? 2 : 1;
}

/** Title, then the time once there's room, then details on long blocks. */
function BlockText({
  details = [],
  end,
  minutes,
  narrow = false,
  start,
  struck = false,
  title,
}: BlockTextProps) {
  // Secondary text at AA contrast on every Google color in both themes.
  const { isDarkColorScheme } = useColorScheme();
  const meta = isDarkColorScheme ? "text-foreground/70" : "text-foreground/80";
  const isShort = minutes < TITLE_ONLY_MINUTES;
  // Until details get their own lines, keep short values in view.
  const shorts = details.flatMap(({ icon, label, short }) =>
    short
      ? [
          <View className="flex-row items-center gap-0.5" key={label}>
            <Icon as={icon} className={meta} size={10} />
            <Text className={`text-[10px] leading-[13px] ${meta}`}>
              {short}
            </Text>
          </View>,
        ]
      : []
  );
  return (
    <View className="min-w-0 flex-1">
      {/* Short blocks keep one line: the time and strain wrap onto a hidden
          second line when they don't fit beside the whole title. */}
      <View
        className={`flex-row items-center gap-x-1 ${isShort ? "h-[14px] flex-wrap overflow-hidden" : ""}`}
      >
        <Text
          className={`font-sans-medium text-[11px] leading-[14px] ${isShort ? "max-w-full" : "shrink"} ${struck ? "text-muted-foreground line-through" : "text-foreground"}`}
          numberOfLines={titleLines(minutes, narrow)}
        >
          {title}
        </Text>
        {isShort ? (
          <Text className={`text-[10px] leading-[13px] ${meta}`}>
            {start.toLocaleString(undefined, {
              hour: "numeric",
              minute: "2-digit",
            })}
          </Text>
        ) : null}
        {isShort ? shorts : null}
      </View>
      {minutes >= TITLE_ONLY_MINUTES && !narrow ? (
        <View className="flex-row items-center gap-1">
          <Text
            className={`shrink text-[10px] leading-[13px] ${meta}`}
            numberOfLines={1}
          >
            {formatTimeRange(start, end)}
          </Text>
          {minutes < DETAILS_MINUTES ? shorts : null}
        </View>
      ) : null}
      {minutes >= DETAILS_MINUTES && !narrow
        ? details.map(({ icon, label }) => (
            <View className="mt-0.5 flex-row items-center gap-1" key={label}>
              <Icon as={icon} className={meta} size={10} />
              <Text
                className={`flex-1 text-[10px] leading-[13px] ${meta}`}
                numberOfLines={1}
              >
                {label}
              </Text>
            </View>
          ))
        : null}
    </View>
  );
}

/** Surface colors for an event: a tint of its color, with the full color as a bar. */
function useEventSurface(color: string | undefined) {
  const { isDarkColorScheme } = useColorScheme();
  const theme = isDarkColorScheme ? THEME.dark : THEME.light;
  const base = color ?? theme.foreground;
  return {
    bar: isDarkColorScheme ? base : mixColor(base, theme.foreground, 0.8),
    border: mixColor(base, theme.background, isDarkColorScheme ? 0.32 : 0.55),
    fill: mixColor(base, theme.background, isDarkColorScheme ? 0.24 : 0.4),
  };
}

function Surface({
  children,
  compact = false,
  surface,
}: {
  children: ReactNode;
  /** Center one line vertically, for short blocks and the all-day row. */
  compact?: boolean;
  surface: ReturnType<typeof useEventSurface>;
}) {
  return (
    <View
      className="h-full flex-row overflow-hidden rounded-[5px]"
      style={{
        backgroundColor: surface.fill,
        borderColor: surface.border,
        borderWidth: 1,
      }}
    >
      <View style={{ backgroundColor: surface.bar, width: 3 }} />
      <View
        className={`min-w-0 flex-1 px-1.5 ${compact ? "justify-center" : "py-1"}`}
      >
        {children}
      </View>
    </View>
  );
}

interface EventBlockProps
  extends BlockPosition,
    Omit<BlockTextProps, "struck"> {
  color: string | undefined;
  /** Opens the editor. Without it, taps still don't fall through to the grid. */
  onPress?: () => void;
}

/** A timed Google event, or a workout, on the grid. */
export function EventBlock({
  color,
  details,
  end,
  minutes,
  onLongPressAt,
  onPress,
  start,
  title,
  ...position
}: EventBlockProps) {
  const surface = useEventSurface(color);
  const placement = positionStyle(position);
  return (
    <Pressable
      accessibilityLabel={describeBlock(title, start, end, details)}
      accessibilityRole={onPress ? "button" : undefined}
      // The background ring keeps whatever is underneath from showing
      // through the gap between side-by-side blocks.
      className={`absolute rounded-md bg-background p-px ${onPress ? "active:opacity-80" : ""}`}
      onLongPress={(event) =>
        onLongPressAt?.(position.top + event.nativeEvent.locationY)
      }
      onPress={(event) => {
        event.stopPropagation();
        onPress?.();
      }}
      style={placement}
    >
      {/* The block itself takes the touch, so locationY is from its top. */}
      <View className="h-full" pointerEvents="none">
        <Surface compact={minutes < COMPACT_MINUTES} surface={surface}>
          <BlockText
            details={details}
            end={end}
            minutes={minutes}
            narrow={placement.width < NARROW_BLOCK_PT}
            start={start}
            title={title}
          />
        </Surface>
      </View>
    </Pressable>
  );
}

interface TaskBlockProps extends BlockPosition, BlockTextProps {
  done: boolean;
  onPress: () => void;
  onToggleDone: () => void;
}

/** A scheduled task: a plain card with a checkbox, so only events carry color. */
export function TaskBlock({
  details,
  done,
  end,
  minutes,
  onLongPressAt,
  onPress,
  onToggleDone,
  start,
  title,
  ...position
}: TaskBlockProps) {
  const compact = minutes < COMPACT_MINUTES;
  const placement = positionStyle(position);
  const longPressAt = (offsetInBlock: number) =>
    onLongPressAt?.(position.top + offsetInBlock);
  // The checkbox and the editor are sibling controls, so VoiceOver reaches
  // both; the outer press area only catches taps on the card's padding.
  return (
    <Pressable
      accessible={false}
      className={`absolute rounded-md bg-background p-px active:opacity-80 ${done ? "opacity-60" : ""}`}
      onLongPress={(event) => longPressAt(event.nativeEvent.locationY)}
      onPress={(event) => {
        event.stopPropagation();
        onPress();
      }}
      style={placement}
    >
      <View
        className={`h-full flex-row gap-1 overflow-hidden rounded-[5px] border border-foreground/20 bg-card px-1 ${compact ? "items-center" : "py-1"}`}
      >
        <Pressable
          accessibilityLabel={title}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: done }}
          hitSlop={8}
          onPress={(event) => {
            event.stopPropagation();
            onToggleDone();
          }}
        >
          <View
            className={`size-3 items-center justify-center rounded-[3px] border ${compact ? "" : "mt-px"} ${done ? "border-primary bg-primary" : "border-foreground/60"}`}
          >
            {done ? (
              <Icon as={Check} className="text-primary-foreground" size={9} />
            ) : null}
          </View>
        </Pressable>
        <Pressable
          accessibilityHint="Opens the task"
          accessibilityLabel={`${describeBlock(title, start, end, details)}${done ? ", done" : ""}`}
          accessibilityRole="button"
          className={`min-w-0 flex-1 ${compact ? "" : "h-full"}`}
          // The text starts about 6pt below the block's top (gap, border, padding).
          onLongPress={(event) => longPressAt(6 + event.nativeEvent.locationY)}
          onPress={(event) => {
            event.stopPropagation();
            onPress();
          }}
        >
          <View className="min-w-0 flex-1" pointerEvents="none">
            <BlockText
              details={details}
              end={end}
              minutes={minutes}
              narrow={placement.width < NARROW_BLOCK_PT}
              start={start}
              struck={done}
              title={title}
            />
          </View>
        </Pressable>
      </View>
    </Pressable>
  );
}

/** An all-day event in the row above the grid. */
export function AllDayBlock({
  color,
  onPress,
  title,
}: {
  color: string | undefined;
  onPress: () => void;
  title: string;
}) {
  const surface = useEventSurface(color);
  return (
    <Pressable
      accessibilityLabel={`${title}, all day`}
      accessibilityRole="button"
      className="h-5 active:opacity-80"
      onPress={onPress}
    >
      <Surface compact surface={surface}>
        <Text
          className="font-sans-medium text-[10px] text-foreground leading-[13px]"
          numberOfLines={1}
        >
          {title}
        </Text>
      </Surface>
    </Pressable>
  );
}
