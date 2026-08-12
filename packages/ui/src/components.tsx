import {
  AlertCircle,
  CheckCircle2,
  Inbox,
  Info,
  Moon,
  Paperclip,
  Search,
  Snowflake,
  Star,
  Sun,
  X,
  XCircle,
} from "lucide-react";
import {
  forwardRef,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type KeyboardEvent,
  type KeyboardEventHandler,
  type ReactNode,
} from "react";

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function getInitials(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  const initials = parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
  return initials || "?";
}

export type MarkSize = "sm" | "md" | "lg";

export interface SubzeroMarkProps extends HTMLAttributes<HTMLDivElement> {
  /** Accessible label for the mark when the visible name is omitted. */
  label?: string;
  /** Render the wordmark beside the glyph. */
  showName?: boolean;
  /** Visible wordmark text. */
  name?: string;
  size?: MarkSize;
  compact?: boolean;
}

export function SubzeroMark({
  label,
  showName = false,
  name = "SUBZERO",
  size = "md",
  compact = false,
  className,
  "aria-label": ariaLabel,
  ...rest
}: SubzeroMarkProps) {
  return (
    <div
      {...rest}
      className={cx(
        "subzero-ui",
        "sz-mark",
        `sz-mark--${size}`,
        compact && "sz-mark--compact",
        className,
      )}
      role="img"
      aria-label={label ?? ariaLabel ?? `${name} Mail`}
    >
      <span className="sz-mark__glyph" aria-hidden="true">
        <Snowflake size="1em" strokeWidth={1.8} />
      </span>
      {showName ? <span className="sz-mark__name">{name}</span> : null}
    </div>
  );
}

export interface FocusTabItem {
  id: string;
  label: string;
  count?: number;
  icon?: ReactNode;
  panelId?: string;
  disabled?: boolean;
}

export interface FocusTabsProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "children" | "onKeyDown"
> {
  items: readonly FocusTabItem[];
  value: string;
  onValueChange: (value: string) => void;
  ariaLabel?: string;
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
}

function findNextEnabledIndex(
  items: readonly FocusTabItem[],
  startIndex: number,
  direction: 1 | -1,
) {
  if (items.length === 0 || items.every((item) => item.disabled)) return -1;

  let index = startIndex;
  for (let step = 0; step < items.length; step += 1) {
    index = (index + direction + items.length) % items.length;
    if (!items[index]?.disabled) return index;
  }
  return -1;
}

export function FocusTabs({
  items,
  value,
  onValueChange,
  ariaLabel,
  className,
  onKeyDown,
  "aria-label": ariaLabelFromProps,
  ...rest
}: FocusTabsProps) {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = Math.max(
    items.findIndex((item) => item.id === value),
    0,
  );

  const handleKeyDown: KeyboardEventHandler<HTMLDivElement> = (event) => {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = findNextEnabledIndex(items, selectedIndex, 1);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = findNextEnabledIndex(items, selectedIndex, -1);
    } else if (event.key === "Home") {
      nextIndex = items.findIndex((item) => !item.disabled);
    } else if (event.key === "End") {
      nextIndex = items.reduce(
        (lastIndex, item, index) => (item.disabled ? lastIndex : index),
        -1,
      );
    }

    if (nextIndex !== null && nextIndex >= 0) {
      event.preventDefault();
      const nextItem = items[nextIndex];
      if (nextItem) {
        onValueChange(nextItem.id);
        tabRefs.current[nextIndex]?.focus();
      }
    }

    onKeyDown?.(event);
  };

  return (
    <div
      {...rest}
      className={cx("subzero-ui", "sz-focus-tabs", className)}
      role="tablist"
      aria-label={ariaLabel ?? ariaLabelFromProps ?? "Focus views"}
      onKeyDown={handleKeyDown}
    >
      {items.map((item, index) => {
        const selected = item.id === value;
        return (
          <button
            key={item.id}
            ref={(element) => {
              tabRefs.current[index] = element;
            }}
            type="button"
            className="sz-focus-tabs__tab"
            role="tab"
            aria-selected={selected}
            aria-controls={item.panelId}
            tabIndex={selected ? 0 : -1}
            disabled={item.disabled}
            data-state={selected ? "active" : "inactive"}
            onClick={() => onValueChange(item.id)}
          >
            {item.icon ? (
              <span className="sz-focus-tabs__icon" aria-hidden="true">
                {item.icon}
              </span>
            ) : null}
            <span>{item.label}</span>
            {item.count !== undefined ? (
              <span
                className="sz-focus-tabs__count"
                aria-label={`${item.count}`}
              >
                {item.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export type StatusPillTone =
  "neutral" | "info" | "success" | "warning" | "error" | "unread";

export interface ThreadRowData {
  id: string;
  sender: string;
  subject: string;
  preview?: string;
  timestamp?: ReactNode;
  unread?: boolean;
  selected?: boolean;
  starred?: boolean;
  hasAttachment?: boolean;
  labels?: readonly string[];
  avatar?: ReactNode;
}

export interface ThreadRowProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "children" | "onSelect" | "type"
> {
  thread: ThreadRowData;
  selected?: boolean;
  onSelect?: (thread: ThreadRowData) => void;
  status?: { label: string; tone?: StatusPillTone };
}

export const ThreadRow = forwardRef<HTMLButtonElement, ThreadRowProps>(
  function ThreadRow(
    {
      thread,
      selected = thread.selected ?? false,
      status,
      className,
      onSelect,
      onClick,
      "aria-label": ariaLabel,
      ...rest
    },
    ref,
  ) {
    const summary = [
      thread.unread ? "Unread" : null,
      thread.starred ? "Starred" : null,
      thread.hasAttachment ? "Has attachment" : null,
      thread.sender,
      thread.subject,
      typeof thread.preview === "string" ? thread.preview : null,
      status?.label,
      ...(thread.labels ?? []),
    ]
      .filter(Boolean)
      .join(". ");

    return (
      <button
        {...rest}
        ref={ref}
        type="button"
        className={cx("subzero-ui", "sz-thread-row", className)}
        aria-label={ariaLabel ?? summary}
        aria-pressed={selected}
        data-state={selected ? "selected" : thread.unread ? "unread" : "idle"}
        onClick={(event) => {
          onSelect?.(thread);
          onClick?.(event);
        }}
      >
        <span className="sz-thread-row__avatar" aria-hidden="true">
          {thread.avatar ?? getInitials(thread.sender)}
        </span>
        <span className="sz-thread-row__body">
          <span className="sz-thread-row__topline">
            <span className="sz-thread-row__sender">{thread.sender}</span>
            {thread.timestamp ? (
              <time className="sz-thread-row__timestamp">
                {thread.timestamp}
              </time>
            ) : null}
          </span>
          <span className="sz-thread-row__subject">{thread.subject}</span>
          {thread.preview ? (
            <span className="sz-thread-row__preview">{thread.preview}</span>
          ) : null}
          {status || thread.labels?.length ? (
            <span className="sz-thread-row__bottomline" aria-hidden="true">
              {status ? (
                <StatusPill tone={status.tone}>{status.label}</StatusPill>
              ) : null}
              {thread.labels?.slice(0, 3).map((label) => (
                <span className="sz-thread-row__label" key={label}>
                  {label}
                </span>
              ))}
            </span>
          ) : null}
        </span>
        <span className="sz-thread-row__indicator" aria-hidden="true">
          {thread.starred ? (
            <span className="sz-thread-row__indicator--starred">
              <Star size={15} fill="currentColor" />
            </span>
          ) : null}
          {thread.hasAttachment ? (
            <span className="sz-thread-row__indicator--attachment">
              <Paperclip size={15} />
            </span>
          ) : null}
        </span>
      </button>
    );
  },
);

ThreadRow.displayName = "ThreadRow";

export interface CommandItem {
  id: string;
  label: string;
  description?: string;
  keywords?: readonly string[];
  shortcut?: string;
  icon?: ReactNode;
  disabled?: boolean;
}

export interface CommandPaletteProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "children" | "title"
> {
  open: boolean;
  commands: readonly CommandItem[];
  onCommand: (command: CommandItem) => void;
  onOpenChange: (open: boolean) => void;
  title?: string;
  description?: string;
  placeholder?: string;
  inputLabel?: string;
  emptyLabel?: string;
  query?: string;
  defaultQuery?: string;
  onQueryChange?: (query: string) => void;
}

export function CommandPalette({
  open,
  commands,
  onCommand,
  onOpenChange,
  title = "Command menu",
  description = "Move through Subzero with the keyboard.",
  placeholder = "Search commands",
  inputLabel = "Search commands",
  emptyLabel = "No commands match that search.",
  query,
  defaultQuery = "",
  onQueryChange,
  className,
  onMouseDown,
  ...rest
}: CommandPaletteProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const listId = useId();
  const [internalQuery, setInternalQuery] = useState(defaultQuery);
  const [activeIndex, setActiveIndex] = useState(0);
  const currentQuery = query ?? internalQuery;

  const filteredCommands = useMemo(() => {
    const normalizedQuery = currentQuery.trim().toLocaleLowerCase();
    if (!normalizedQuery)
      return commands.filter((command) => !command.disabled);
    return commands.filter((command) => {
      if (command.disabled) return false;
      const searchText = [
        command.label,
        command.description,
        ...(command.keywords ?? []),
      ]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase();
      return searchText.includes(normalizedQuery);
    });
  }, [commands, currentQuery]);

  const safeActiveIndex = Math.min(
    activeIndex,
    Math.max(filteredCommands.length - 1, 0),
  );
  const activeCommand = filteredCommands[safeActiveIndex];

  useEffect(() => {
    setActiveIndex(0);
  }, [currentQuery]);

  useEffect(() => {
    if (!open) return;
    const previousActiveElement =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    inputRef.current?.focus();
    return () => {
      previousActiveElement?.focus({ preventScroll: true });
    };
  }, [open]);

  if (!open) return null;

  const setQueryValue = (nextQuery: string) => {
    if (query === undefined) setInternalQuery(nextQuery);
    onQueryChange?.(nextQuery);
  };

  const selectCommand = (command: CommandItem | undefined) => {
    if (!command) return;
    onCommand(command);
    onOpenChange(false);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onOpenChange(false);
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (filteredCommands.length > 0) {
        setActiveIndex((index) => (index + 1) % filteredCommands.length);
      }
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (filteredCommands.length > 0) {
        setActiveIndex(
          (index) =>
            (index - 1 + filteredCommands.length) % filteredCommands.length,
        );
      }
      return;
    }

    if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
      return;
    }

    if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(Math.max(filteredCommands.length - 1, 0));
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      selectCommand(activeCommand);
    }
  };

  return (
    <div
      {...rest}
      className={cx("subzero-ui", "sz-command-palette", className)}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onOpenChange(false);
        onMouseDown?.(event);
      }}
    >
      <div
        ref={dialogRef}
        className="sz-command-palette__dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onOpenChange(false);
            return;
          }

          if (event.key === "Tab") {
            const focusableElements = Array.from(
              dialogRef.current?.querySelectorAll<HTMLElement>(
                "button:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex='-1'])",
              ) ?? [],
            );
            const firstElement = focusableElements[0];
            const lastElement = focusableElements.at(-1);
            if (!firstElement || !lastElement) return;

            if (event.shiftKey && document.activeElement === firstElement) {
              event.preventDefault();
              lastElement.focus();
            } else if (
              !event.shiftKey &&
              document.activeElement === lastElement
            ) {
              event.preventDefault();
              firstElement.focus();
            }
          }
        }}
      >
        <header className="sz-command-palette__header">
          <div>
            <h2 className="sz-command-palette__title" id={titleId}>
              {title}
            </h2>
            {description ? (
              <p className="sz-command-palette__description" id={descriptionId}>
                {description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            className="sz-command-palette__close"
            aria-label="Close command menu"
            onClick={() => onOpenChange(false)}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <div className="sz-command-palette__search">
          <Search size={17} aria-hidden="true" />
          <label className="sz-visually-hidden" htmlFor={`${listId}-input`}>
            {inputLabel}
          </label>
          <input
            ref={inputRef}
            id={`${listId}-input`}
            type="search"
            value={currentQuery}
            placeholder={placeholder}
            autoComplete="off"
            spellCheck={false}
            role="combobox"
            aria-controls={listId}
            aria-expanded="true"
            aria-autocomplete="list"
            aria-activedescendant={
              activeCommand ? `${listId}-${safeActiveIndex}` : undefined
            }
            onChange={(event) => setQueryValue(event.target.value)}
            onKeyDown={handleKeyDown}
          />
        </div>

        <div
          className="sz-command-palette__list"
          id={listId}
          role="listbox"
          aria-label="Available commands"
        >
          {filteredCommands.length === 0 ? (
            <p className="sz-command-palette__empty" role="status">
              {emptyLabel}
            </p>
          ) : (
            filteredCommands.map((command, index) => {
              const active = index === safeActiveIndex;
              return (
                <button
                  key={command.id}
                  type="button"
                  id={`${listId}-${index}`}
                  className="sz-command-palette__item"
                  role="option"
                  aria-selected={active}
                  data-state={active ? "active" : "idle"}
                  onMouseMove={() => setActiveIndex(index)}
                  onClick={() => selectCommand(command)}
                >
                  <span
                    className="sz-command-palette__item-icon"
                    aria-hidden="true"
                  >
                    {command.icon ?? <Info size={16} />}
                  </span>
                  <span className="sz-command-palette__item-copy">
                    <span className="sz-command-palette__item-label">
                      {command.label}
                    </span>
                    {command.description ? (
                      <span className="sz-command-palette__item-description">
                        {command.description}
                      </span>
                    ) : null}
                  </span>
                  {command.shortcut ? (
                    <kbd className="sz-command-palette__shortcut">
                      {command.shortcut}
                    </kbd>
                  ) : null}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

export interface MessageSurfaceProps extends Omit<
  HTMLAttributes<HTMLElement>,
  "children" | "title"
> {
  sender: string;
  senderAddress?: string;
  recipients?: ReactNode;
  timestamp?: ReactNode;
  avatar?: ReactNode;
  actions?: ReactNode;
  status?: ReactNode;
  unread?: boolean;
  children?: ReactNode;
}

export const MessageSurface = forwardRef<HTMLElement, MessageSurfaceProps>(
  function MessageSurface(
    {
      sender,
      senderAddress,
      recipients,
      timestamp,
      avatar,
      actions,
      status,
      unread = false,
      children,
      className,
      role,
      "aria-label": ariaLabel,
      "aria-labelledby": ariaLabelledBy,
      ...rest
    },
    ref,
  ) {
    const senderId = useId();
    return (
      <article
        {...rest}
        ref={ref}
        className={cx("subzero-ui", "sz-message-surface", className)}
        role={role ?? "article"}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabel ? undefined : (ariaLabelledBy ?? senderId)}
        data-unread={unread}
      >
        <header className="sz-message-surface__header">
          <div className="sz-message-surface__identity">
            <span className="sz-message-surface__avatar" aria-hidden="true">
              {avatar ?? getInitials(sender)}
            </span>
            <div>
              <h3 className="sz-message-surface__sender" id={senderId}>
                {sender}
              </h3>
              {senderAddress ? (
                <p className="sz-message-surface__address">{senderAddress}</p>
              ) : null}
              {recipients ? (
                <p className="sz-message-surface__recipients">
                  To {recipients}
                </p>
              ) : null}
            </div>
          </div>
          <div className="sz-message-surface__meta">
            {status}
            {timestamp ? <time>{timestamp}</time> : null}
            {actions ? (
              <div className="sz-message-surface__actions">{actions}</div>
            ) : null}
          </div>
        </header>
        {children ? (
          <div className="sz-message-surface__body">{children}</div>
        ) : null}
      </article>
    );
  },
);

MessageSurface.displayName = "MessageSurface";

export type ThemeMode = "light" | "dark";

export interface ThemeToggleProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "children" | "onClick" | "type"
> {
  theme: ThemeMode;
  onThemeChange: (theme: ThemeMode) => void;
  showLabel?: boolean;
}

export function ThemeToggle({
  theme,
  onThemeChange,
  showLabel = false,
  className,
  "aria-label": ariaLabel,
  ...rest
}: ThemeToggleProps) {
  const nextTheme: ThemeMode = theme === "dark" ? "light" : "dark";
  const Icon = theme === "dark" ? Sun : Moon;
  const actionLabel = ariaLabel ?? `Switch to ${nextTheme} theme`;

  return (
    <button
      {...rest}
      type="button"
      className={cx("subzero-ui", "sz-theme-toggle", className)}
      aria-label={actionLabel}
      aria-pressed={theme === "dark"}
      title={actionLabel}
      data-theme={theme}
      onClick={() => onThemeChange(nextTheme)}
    >
      <Icon size={17} aria-hidden="true" />
      {showLabel ? (
        <span className="sz-theme-toggle__label">{nextTheme}</span>
      ) : null}
    </button>
  );
}

export type EmptyStateTone = "neutral" | "info" | "success" | "error";

export interface EmptyStateProps extends Omit<
  HTMLAttributes<HTMLElement>,
  "children" | "title"
> {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  tone?: EmptyStateTone;
}

export function EmptyState({
  title,
  description,
  action,
  icon,
  tone = "neutral",
  className,
  role,
  "aria-labelledby": ariaLabelledBy,
  ...rest
}: EmptyStateProps) {
  const titleId = useId();
  return (
    <section
      {...rest}
      className={cx("subzero-ui", "sz-empty-state", className)}
      role={role ?? (tone === "error" ? "alert" : "status")}
      aria-labelledby={ariaLabelledBy ?? titleId}
      data-tone={tone}
    >
      <span className="sz-empty-state__icon" aria-hidden="true">
        {icon ?? <Inbox size={23} strokeWidth={1.7} />}
      </span>
      <h2 className="sz-empty-state__title" id={titleId}>
        {title}
      </h2>
      {description ? (
        <p className="sz-empty-state__description">{description}</p>
      ) : null}
      {action ? <div className="sz-empty-state__action">{action}</div> : null}
    </section>
  );
}

export interface StatusPillProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: StatusPillTone;
  icon?: ReactNode;
  live?: boolean;
  children: ReactNode;
}

export function StatusPill({
  tone = "neutral",
  icon,
  live = false,
  children,
  className,
  role,
  ...rest
}: StatusPillProps) {
  const Icon =
    tone === "success"
      ? CheckCircle2
      : tone === "warning"
        ? AlertCircle
        : tone === "error"
          ? XCircle
          : tone === "info" || tone === "unread"
            ? Info
            : null;

  return (
    <span
      {...rest}
      className={cx("subzero-ui", "sz-status-pill", className)}
      role={role ?? (live ? "status" : undefined)}
      aria-live={live ? "polite" : undefined}
      aria-atomic={live ? "true" : undefined}
      data-tone={tone}
    >
      <span className="sz-status-pill__icon" aria-hidden="true">
        {icon ?? (Icon ? <Icon size={13} strokeWidth={2} /> : null)}
      </span>
      <span>{children}</span>
    </span>
  );
}
