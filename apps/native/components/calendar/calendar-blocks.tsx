import type { Event as GoogleEvent } from "@kompose/google-cal/schema";
import { extractMeetingLink } from "@kompose/state/meeting";
import { withSoftHyphens } from "@kompose/state/soft-hyphens";
import {
  formatClockRange,
  formatTimeRange,
} from "@kompose/state/temporal-utils";
import type { LucideIcon } from "lucide-react-native";
import { Check, MapPin, Video } from "lucide-react-native";
import { type ReactNode, useRef } from "react";
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
  /**
   * Minutes before a later item is drawn over this one (ItemLayout); the
   * text fits that part, top-aligned, so it isn't cut off mid-line.
   */
  uncoveredMinutes?: number;
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
  /** Short of room for AM/PM: the time reads "11:30 – 12:30". */
  clockTime?: boolean;
  details?: BlockDetail[];
  end: Temporal.ZonedDateTime;
  /** Visible minutes, which set how much text fits. */
  minutes: number;
  /**
   * Too narrow for the time (side by side on a busy day): the title takes
   * its lines instead. There's no hover on a phone, so the title matters most.
   */
  narrow?: boolean;
  /**
   * Narrower than a short word: one line with an ellipsis, since iOS would
   * otherwise wrap a word letter by letter.
   */
  sliver?: boolean;
  start: Temporal.ZonedDateTime;
  struck?: boolean;
  /** Fit the title on one 12pt line, for a thin strip left above a cover. */
  tight?: boolean;
  title: string;
}

/**
 * A covered block showing fewer minutes than this has a strip too thin for
 * a 14pt line plus padding (at 60pt an hour, 15 minutes is 15pt), so its
 * title drops the padding and sits on a 12pt line.
 */
const TIGHT_MINUTES = 20;

/** Whether a block's visible strip needs the tight title line. */
function isTight(textMinutes: number, minutes: number) {
  return textMinutes < minutes && textMinutes < TIGHT_MINUTES;
}

/** The block's background ring (p-px), between its edge and its card. */
const BLOCK_RING_PT = 1;

/** Narrower than this, a block shows its title in place of the time. */
const NARROW_BLOCK_PT = 72;

/** Narrower than this, times drop AM/PM (the 3-day view on a phone). */
const CLOCK_TIME_BLOCK_PT = 120;

/** Narrower than this, the title keeps to one line (see BlockText `sliver`). */
const SLIVER_BLOCK_PT = 44;

/**
 * Title lines that fit. A narrow block drops its time line and padding and
 * sets the title on 12pt lines, as many as its visible minutes hold (60pt
 * an hour, less 6pt: the 1pt gap below it, its ring, border, and 1pt top
 * padding), up to three.
 */
function titleLines(minutes: number, narrow: boolean, sliver: boolean): number {
  if (sliver) {
    return 1;
  }
  if (narrow) {
    return Math.min(3, Math.max(1, Math.floor((minutes - 6) / 12)));
  }
  return minutes >= TWO_LINE_TITLE_MINUTES ? 2 : 1;
}

/** A block's title: one line in a short block, as many as fit when narrow. */
function BlockTitle({
  minutes,
  narrow,
  oneLine,
  sliver,
  struck,
  tight,
  title,
}: {
  minutes: number;
  narrow: boolean;
  oneLine: boolean;
  sliver: boolean;
  struck: boolean;
  tight: boolean;
  title: string;
}) {
  const leading = tight || narrow ? "leading-[12px]" : "leading-[14px]";
  const color = struck
    ? "text-muted-foreground line-through"
    : "text-foreground";
  return (
    <Text
      className={`font-sans-medium text-[11px] ${leading} ${oneLine ? "max-w-full" : "shrink"} ${color}`}
      numberOfLines={titleLines(minutes, narrow, sliver)}
    >
      {/* Narrow blocks break long words at a soft hyphen ("Road-map")
          rather than cutting them to an ellipsis. */}
      {narrow ? withSoftHyphens(title) : title}
    </Text>
  );
}

/** The time line: the time first, and values that don't fit beside it drop out. */
function BlockTimeRow({
  children,
  clockTime,
  end,
  meta,
  start,
}: {
  children: ReactNode;
  clockTime: boolean;
  end: Temporal.ZonedDateTime;
  meta: string;
  start: Temporal.ZonedDateTime;
}) {
  // An overnight range keeps AM/PM (and dates when it needs them).
  const text =
    clockTime && start.toPlainDate().equals(end.toPlainDate())
      ? formatClockRange(start, end)
      : formatTimeRange(start, end);
  return (
    <View className="h-[13px] flex-row flex-wrap items-center gap-x-1 overflow-hidden">
      <Text
        className={`max-w-full text-[10px] leading-[13px] ${meta}`}
        numberOfLines={1}
      >
        {text}
      </Text>
      {children}
    </View>
  );
}

/** Title, then the time once there's room, then details on long blocks. */
function BlockText({
  clockTime = false,
  details = [],
  end,
  minutes,
  narrow = false,
  sliver = false,
  start,
  struck = false,
  tight = false,
  title,
}: BlockTextProps) {
  // Secondary text at AA contrast on every Google color in both themes.
  const { isDarkColorScheme } = useColorScheme();
  const meta = isDarkColorScheme ? "text-foreground/70" : "text-foreground/80";
  // Short blocks keep one line, unless narrow: then the title takes the
  // lines (titleLines) and the time is left out.
  const isShort = minutes < TITLE_ONLY_MINUTES && !narrow;
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
        className={`flex-row items-center gap-x-1 ${isShort ? `${tight ? "h-[12px]" : "h-[14px]"} flex-wrap overflow-hidden` : ""}`}
      >
        <BlockTitle
          minutes={minutes}
          narrow={narrow}
          oneLine={isShort}
          sliver={sliver}
          struck={struck}
          tight={tight}
          title={title}
        />
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
        <BlockTimeRow clockTime={clockTime} end={end} meta={meta} start={start}>
          {minutes < DETAILS_MINUTES ? shorts : null}
        </BlockTimeRow>
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

/** Vertical padding: none for one centered line, a little when narrow. */
function blockPadding(compact: boolean, narrow: boolean) {
  if (compact) {
    return "";
  }
  return narrow ? "pt-px" : "py-1";
}

function Surface({
  children,
  compact = false,
  covered = false,
  narrow = false,
  surface,
  tight = false,
}: {
  children: ReactNode;
  /** Center one line vertically, for short blocks and the all-day row. */
  compact?: boolean;
  /** Something is drawn over the block's lower part: keep text at the top. */
  covered?: boolean;
  /** No top padding, for the tight title line. */
  tight?: boolean;
  /** Narrow: less padding, for more title lines (see titleLines). */
  narrow?: boolean;
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
        className={`min-w-0 flex-1 px-1.5 ${compact && !covered ? "justify-center" : ""} ${compact && covered && !tight ? "pt-0.5" : ""} ${blockPadding(compact, narrow)}`}
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
  const textMinutes = Math.min(minutes, position.uncoveredMinutes ?? minutes);
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
        <Surface
          compact={textMinutes < COMPACT_MINUTES}
          covered={textMinutes < minutes}
          narrow={placement.width < NARROW_BLOCK_PT}
          surface={surface}
          tight={isTight(textMinutes, minutes)}
        >
          <BlockText
            clockTime={placement.width < CLOCK_TIME_BLOCK_PT}
            details={details}
            end={end}
            minutes={textMinutes}
            narrow={placement.width < NARROW_BLOCK_PT}
            sliver={placement.width < SLIVER_BLOCK_PT}
            start={start}
            tight={isTight(textMinutes, minutes)}
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
  const textMinutes = Math.min(minutes, position.uncoveredMinutes ?? minutes);
  const compact = textMinutes < COMPACT_MINUTES;
  const isCovered = textMinutes < minutes;
  const tight = isTight(textMinutes, minutes);
  const placement = positionStyle(position);
  const bodyTopRef = useRef(0);
  const narrow = placement.width < NARROW_BLOCK_PT;
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
        className={`h-full flex-row gap-1 overflow-hidden rounded-[5px] border border-foreground/20 bg-card px-1 ${compact && !isCovered ? "items-center" : ""} ${compact && isCovered && !tight ? "pt-0.5" : ""} ${blockPadding(compact, narrow)}`}
      >
        {/* Narrow blocks give the checkbox's room to the title; done is in
            the editor and the long-press menu. */}
        {narrow ? null : (
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
        )}
        <Pressable
          accessibilityHint="Opens the task"
          accessibilityLabel={`${describeBlock(title, start, end, details)}${done ? ", done" : ""}`}
          accessibilityRole="button"
          className={`min-w-0 flex-1 ${compact ? "" : "h-full"}`}
          // Measured: the text area's top within the block (ring, border,
          // and padding, or centering in a compact block).
          onLayout={(event) => {
            bodyTopRef.current = BLOCK_RING_PT + event.nativeEvent.layout.y;
          }}
          onLongPress={(event) =>
            longPressAt(bodyTopRef.current + event.nativeEvent.locationY)
          }
          onPress={(event) => {
            event.stopPropagation();
            onPress();
          }}
        >
          <View className="min-w-0 flex-1" pointerEvents="none">
            <BlockText
              clockTime={placement.width < CLOCK_TIME_BLOCK_PT}
              details={details}
              end={end}
              minutes={textMinutes}
              narrow={narrow}
              sliver={placement.width < SLIVER_BLOCK_PT}
              start={start}
              struck={done}
              tight={tight}
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
