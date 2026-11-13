import type { Event as GoogleEvent } from "@kompose/google-cal/schema";
import { extractMeetingLink } from "@kompose/state/meeting";
import { withSoftHyphens } from "@kompose/state/soft-hyphens";
import {
  formatClockRange,
  formatTimeRange,
} from "@kompose/state/temporal-utils";
import type { LucideIcon } from "lucide-react-native";
import { Check, MapPin, Video } from "lucide-react-native";
import { type ReactNode, useRef, useState } from "react";
import { Pressable, useWindowDimensions, View } from "react-native";
import type { Temporal } from "temporal-polyfill";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { mixColor } from "@/lib/color-mix";
import { useColorScheme } from "@/lib/color-scheme-context";
import { THEME } from "@/lib/theme";
import { fitBlockRest } from "./block-fit";

/**
 * The calendar's grid text (blocks, day headers, the time gutter) grows
 * with the system text size up to this, and its fixed rows grow with it:
 * a block's height is its time, and the gutter and columns have fixed
 * widths, so the text can't grow without limit.
 */
export const MAX_CALENDAR_TEXT_SCALE = 1.5;

/** How much the grid's text has grown with the system text size (capped). */
export function useCalendarTextScale(): number {
  return Math.min(useWindowDimensions().fontScale, MAX_CALENDAR_TEXT_SCALE);
}

/**
 * A block is drawn at least this many minutes tall (points, at 60pt an
 * hour), so a short one stays readable and tappable. The collision layout
 * measures what covers a block against this drawn length too.
 */
export const MIN_DRAWN_MINUTES = 24;

/**
 * A block's drawn minutes, and the part of them a later block leaves in
 * view (`ItemLayout.uncoveredMinutes`, measured against the drawn length).
 */
function shownMinutes(minutes: number, uncoveredMinutes: number | undefined) {
  const drawn = Math.max(minutes, MIN_DRAWN_MINUTES);
  return { drawn, text: Math.min(drawn, uncoveredMinutes ?? drawn) };
}

/** Blocks shorter than this show only their title. */
const TITLE_ONLY_MINUTES = 45;
/** Blocks at least this long also list their details. */
const DETAILS_MINUTES = 60;
/** Blocks at least this long let the title wrap to two lines. */
const TWO_LINE_TITLE_MINUTES = 90;
/**
 * Points around a block's text: the gap below it, its ring, border and
 * vertical padding.
 */
const BLOCK_CHROME_PT = 13;

/**
 * The block length that holds `linesPt` of text (at the default size) once
 * the text has grown by `scale`, never less than `atDefault`: at 60pt an
 * hour, minutes are points.
 */
function minutesFor(atDefault: number, linesPt: number, scale: number) {
  return Math.max(atDefault, linesPt * scale + BLOCK_CHROME_PT);
}

/** Blocks shorter than this center one line with no vertical padding. */
const COMPACT_MINUTES = 30;

export interface BlockDetail {
  icon: LucideIcon;
  label: string;
  /**
   * Show only with the whole label: the icon alone says nothing (a due
   * date's icon without its date).
   */
  needsLabel?: boolean;
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
  /** Free text under everything else, in whatever whole lines are left. */
  description?: string | null;
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
   * Points the text has when the block's height bounds it to one line (a
   * compact block, or a strip left above a later one); see `textRoom`.
   */
  room?: number;
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

/** Points the block's ring and border take on each side. */
const BLOCK_FRAME_PT = 2;

/** The top padding of a compact strip left above a later block (pt-0.5). */
const COVERED_PAD_PT = 2;

/**
 * Points a compact block has for its one line of text: a strip left above
 * a later block shows its visible minutes (minutes are points) less its
 * ring, border and top padding; an uncovered one is centered in its
 * height less its frame on both sides. Undefined for a taller block, whose
 * padding and line cut-offs (`minutesFor`) leave room to spare.
 */
function textRoom(
  textMinutes: number,
  minutes: number,
  height: number
): number | undefined {
  if (textMinutes >= COMPACT_MINUTES) {
    return;
  }
  if (textMinutes < minutes) {
    const pad = isTight(textMinutes, minutes) ? 0 : COVERED_PAD_PT;
    return textMinutes - BLOCK_FRAME_PT - pad;
  }
  return height - 2 * BLOCK_FRAME_PT;
}

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
function titleLines(
  minutes: number,
  narrow: boolean,
  sliver: boolean,
  scale: number
): number {
  if (sliver) {
    return 1;
  }
  if (narrow) {
    return Math.min(3, Math.max(1, Math.floor((minutes - 6) / (12 * scale))));
  }
  // Two title lines, the time and a detail line.
  return minutes >= minutesFor(TWO_LINE_TITLE_MINUTES, 28 + 13 + 15, scale)
    ? 2
    : 1;
}

/** A block's title: one line in a short block, as many as fit when narrow. */
function BlockTitle({
  maxLines,
  narrow,
  oneLine,
  onLines,
  scale,
  struck,
  tight,
  title,
}: {
  maxLines: number;
  narrow: boolean;
  oneLine: boolean;
  /** The lines the title takes, for fitting what goes under it. */
  onLines?: (lines: number) => void;
  scale: number;
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
      maxFontSizeMultiplier={scale}
      numberOfLines={maxLines}
      onTextLayout={
        onLines
          ? (event) =>
              onLines(Math.min(event.nativeEvent.lines.length, maxLines))
          : undefined
      }
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
  scale,
  start,
}: {
  children: ReactNode;
  clockTime: boolean;
  end: Temporal.ZonedDateTime;
  meta: string;
  scale: number;
  start: Temporal.ZonedDateTime;
}) {
  // An overnight range keeps AM/PM (and dates when it needs them).
  const text =
    clockTime && start.toPlainDate().equals(end.toPlainDate())
      ? formatClockRange(start, end)
      : formatTimeRange(start, end);
  return (
    <View
      className="flex-row flex-wrap items-center gap-x-1 overflow-hidden"
      style={{ height: 13 * scale }}
    >
      <Text
        className={`max-w-full text-[10px] leading-[13px] ${meta}`}
        maxFontSizeMultiplier={scale}
        numberOfLines={1}
      >
        {text}
      </Text>
      {children}
    </View>
  );
}

/**
 * A block's details on a line that wraps onto a hidden second line, so
 * whatever doesn't fit drops out whole, in order, leaving no gap. A tag's
 * icon and name are separate items, so the icon stays when only it fits;
 * a detail that needs its label is one item, shown whole or not at all. A
 * detail with a short value (a workout's strain) shows the icon and value.
 */
function inlineDetails(details: BlockDetail[], meta: string, scale: number) {
  const label = (text: string) => (
    <Text
      className={`text-[10px] leading-[13px] ${meta}`}
      maxFontSizeMultiplier={scale}
    >
      {text}
    </Text>
  );
  return details.flatMap(({ icon, label: text, needsLabel, short }) => {
    if (short || needsLabel) {
      return [
        <View className="flex-row items-center gap-0.5" key={text}>
          <Icon as={icon} className={meta} size={10} />
          {label(short ?? text)}
        </View>,
      ];
    }
    return [
      <View key={`${text}-icon`}>
        <Icon as={icon} className={meta} size={10} />
      </View>,
      <View className="-ml-0.5" key={text}>
        {label(text)}
      </View>,
    ];
  });
}

/**
 * Under the title and time: detail rows, then the description, each in
 * whole lines, as many as `roomPt` holds.
 */
function BlockRest({
  description,
  details,
  meta,
  roomPt,
  scale,
}: {
  description?: string | null;
  /** The details that get rows; none below the detail-row height. */
  details: BlockDetail[];
  meta: string;
  roomPt: number;
  scale: number;
}) {
  const { descriptionLines, rows } = fitBlockRest({
    detailCount: details.length,
    roomPt,
    scale,
  });
  return (
    <>
      {details.slice(0, rows).map(({ icon, label }) => (
        <View className="mt-0.5 flex-row items-center gap-1" key={label}>
          <Icon as={icon} className={meta} size={10} />
          <Text
            className={`flex-1 text-[10px] leading-[13px] ${meta}`}
            maxFontSizeMultiplier={scale}
            numberOfLines={1}
          >
            {label}
          </Text>
        </View>
      ))}
      {description && descriptionLines > 0 ? (
        <Text
          className={`mt-0.5 text-[10px] leading-[13px] ${meta}`}
          maxFontSizeMultiplier={scale}
          numberOfLines={descriptionLines}
        >
          {description}
        </Text>
      ) : null}
    </>
  );
}

/**
 * Title, then the time once there's room, then details on long blocks, and
 * a task's description in the whole lines left.
 */
function BlockText({
  clockTime = false,
  description,
  details = [],
  end,
  minutes,
  narrow = false,
  room,
  sliver = false,
  start,
  struck = false,
  tight = false,
  title,
}: BlockTextProps) {
  // Secondary text at AA contrast on every Google color in both themes.
  const { isDarkColorScheme } = useColorScheme();
  const meta = isDarkColorScheme ? "text-foreground/70" : "text-foreground/80";
  const calendarScale = useCalendarTextScale();
  // A block whose height bounds it to one line grows that line only as far
  // as its room, so the line is never clipped or covered.
  const line = tight || narrow ? 12 : 14;
  const scale =
    room === undefined
      ? calendarScale
      : Math.min(calendarScale, Math.max(1, room / line));
  // Short blocks keep one line, unless narrow: then the title takes the
  // lines (titleLines) and the time is left out.
  // The title and time line, then a detail line (13pt and a 2pt gap).
  const showsTime = minutes >= minutesFor(TITLE_ONLY_MINUTES, 14 + 13, scale);
  const showsDetails =
    minutes >= minutesFor(DETAILS_MINUTES, 14 + 13 + 15, scale);
  const isShort = !(showsTime || narrow);
  const maxTitleLines = titleLines(minutes, narrow, sliver, scale);
  // Until the title is laid out, assume it takes all its lines.
  const [titleLineCount, setTitleLineCount] = useState(maxTitleLines);
  const fitsRest = showsTime && !narrow;
  const inline = inlineDetails(details, meta, scale);
  return (
    <View className="min-w-0 flex-1">
      {/* Short blocks keep one line: the time and details wrap onto a
          hidden second line when they don't fit beside the whole title. */}
      <View
        className={`flex-row items-center gap-x-1 ${isShort ? "flex-wrap overflow-hidden" : ""}`}
        style={isShort ? { height: (tight ? 12 : 14) * scale } : undefined}
      >
        <BlockTitle
          maxLines={maxTitleLines}
          narrow={narrow}
          oneLine={isShort}
          onLines={
            fitsRest && maxTitleLines > 1 ? setTitleLineCount : undefined
          }
          scale={scale}
          struck={struck}
          tight={tight}
          title={title}
        />
        {isShort ? (
          <Text
            className={`text-[10px] leading-[13px] ${meta}`}
            maxFontSizeMultiplier={scale}
          >
            {start.toLocaleString(undefined, {
              hour: "numeric",
              minute: "2-digit",
            })}
          </Text>
        ) : null}
        {isShort ? inline : null}
      </View>
      {fitsRest ? (
        <BlockTimeRow
          clockTime={clockTime}
          end={end}
          meta={meta}
          scale={scale}
          start={start}
        >
          {showsDetails ? null : inline}
        </BlockTimeRow>
      ) : null}
      {fitsRest ? (
        <BlockRest
          description={description}
          details={showsDetails ? details : []}
          meta={meta}
          // What's left under the title and time (minutes are points).
          roomPt={
            minutes -
            BLOCK_CHROME_PT -
            (Math.min(titleLineCount, maxTitleLines) * 14 + 13) * scale
          }
          scale={scale}
        />
      ) : null}
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
  const { drawn, text: textMinutes } = shownMinutes(
    minutes,
    position.uncoveredMinutes
  );
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
          covered={textMinutes < drawn}
          narrow={placement.width < NARROW_BLOCK_PT}
          surface={surface}
          tight={isTight(textMinutes, drawn)}
        >
          <BlockText
            clockTime={placement.width < CLOCK_TIME_BLOCK_PT}
            details={details}
            end={end}
            minutes={textMinutes}
            narrow={placement.width < NARROW_BLOCK_PT}
            room={textRoom(textMinutes, drawn, placement.height)}
            sliver={placement.width < SLIVER_BLOCK_PT}
            start={start}
            tight={isTight(textMinutes, drawn)}
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
  description,
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
  const { drawn, text: textMinutes } = shownMinutes(
    minutes,
    position.uncoveredMinutes
  );
  const compact = textMinutes < COMPACT_MINUTES;
  const isCovered = textMinutes < drawn;
  const tight = isTight(textMinutes, drawn);
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
              description={description}
              details={details}
              end={end}
              minutes={textMinutes}
              narrow={narrow}
              room={textRoom(textMinutes, drawn, placement.height)}
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
  const scale = useCalendarTextScale();
  return (
    <Pressable
      accessibilityLabel={`${title}, all day`}
      accessibilityRole="button"
      className="active:opacity-80"
      onPress={onPress}
      style={{ height: 20 * scale }}
    >
      <Surface compact surface={surface}>
        <Text
          className="font-sans-medium text-[10px] text-foreground leading-[13px]"
          maxFontSizeMultiplier={MAX_CALENDAR_TEXT_SCALE}
          numberOfLines={1}
        >
          {title}
        </Text>
      </Surface>
    </Pressable>
  );
}
