import { useEffect, useRef, useState } from "react";
import { Clock3 } from "lucide-react";
import { Button } from "@/components/ui/button-custom";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { clampWindowTimeToHour, getWindowTimeOptions } from "@/lib/availability-window-time";
import { cn } from "@/lib/utils";

type AvailabilityWindowTimePickerProps = {
  id: string;
  label: string;
  value: string;
  minTime: string;
  maxTime: string;
  disabled?: boolean;
  onChange: (value: string) => void;
};

export function AvailabilityWindowTimePicker({
  id,
  label,
  value,
  minTime,
  maxTime,
  disabled = false,
  onChange,
}: AvailabilityWindowTimePickerProps) {
  const [open, setOpen] = useState(false);
  const hoursListRef = useRef<HTMLDivElement>(null);
  const minutesListRef = useRef<HTMLDivElement>(null);
  const [hour = "00", minute = "00"] = value.split(":");
  const { hours: hourOptions } = getWindowTimeOptions(minTime, maxTime, hour);
  const selectedHour = hourOptions.includes(hour) ? hour : hourOptions[0] ?? hour;
  const { minutes: minuteOptions } = getWindowTimeOptions(minTime, maxTime, selectedHour);
  const selectedMinute = minuteOptions.includes(minute) ? minute : minuteOptions[0] ?? minute;

  const chooseHour = (nextHour: string) => {
    const nextTime = clampWindowTimeToHour(nextHour, minute, minTime, maxTime);
    if (nextTime) onChange(nextTime);
  };

  const chooseMinute = (nextMinute: string, close: boolean) => {
    onChange(`${selectedHour}:${nextMinute}`);
    if (close) setOpen(false);
  };

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      for (const [list, selected] of [
        [hoursListRef.current, hourOptions.indexOf(selectedHour)],
        [minutesListRef.current, minuteOptions.indexOf(selectedMinute)],
      ] as const) {
        if (list) {
          const optionHeight = list.querySelector("button")?.getBoundingClientRect().height ?? 36;
          list.scrollTop = Math.max(0, selected) * optionHeight - (list.clientHeight - optionHeight) / 2;
        }
      }
      (hoursListRef.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')
        ?? hoursListRef.current?.querySelector<HTMLButtonElement>("button"))?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open, selectedHour, minTime, maxTime]);

  return (
    <Popover modal open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          aria-label={`${label}: ${value}`}
          disabled={disabled || hourOptions.length === 0}
          className="h-11 w-full min-w-0 justify-between gap-2 border-white/10 bg-background/50 px-3 text-white"
        >
          <span>{value}</span>
          <Clock3 className="h-4 w-4 shrink-0 opacity-70" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="top"
        collisionPadding={8}
        onOpenAutoFocus={(event) => event.preventDefault()}
        className="w-56 max-w-[calc(100vw-1rem)] border-white/10 bg-card p-2 text-foreground"
        aria-label={`Selecionar hora de ${label.toLowerCase()}`}
      >
        <div className="grid grid-cols-2 gap-2 pb-1 text-center text-xs font-medium text-muted-foreground">
          <span>Horas</span>
          <span>Minutos</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {([hourOptions, minuteOptions] as const).map((options, column) => (
            <div
              key={column}
              ref={column === 0 ? hoursListRef : minutesListRef}
              role="group"
              aria-label={column === 0 ? "Horas" : "Minutos"}
              className="h-44 overflow-y-auto overscroll-contain rounded-md border border-border bg-background/60 p-1"
            >
              {options.map((option) => {
                const selected = option === (column === 0 ? hour : minute) && (column === 0 || selectedHour === hour);
                const focusable = option === (column === 0 ? selectedHour : selectedMinute);
                return (
                  <button
                    key={option}
                    type="button"
                    aria-label={`${option} ${column === 0 ? "horas" : "minutos"}`}
                    aria-pressed={selected}
                    tabIndex={focusable ? 0 : -1}
                    className={cn(
                      "flex h-9 w-full items-center justify-center rounded-sm text-sm tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      selected
                        ? "bg-primary font-semibold text-primary-foreground"
                        : "text-foreground hover:bg-accent/30",
                    )}
                    onClick={() => {
                      if (column === 0) chooseHour(option);
                      else chooseMinute(option, true);
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
                      event.preventDefault();
                      const index = options.indexOf(option);
                      const next = options[(index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length];
                      if (column === 0) chooseHour(next);
                      else chooseMinute(next, false);
                      event.currentTarget.parentElement
                        ?.querySelector<HTMLButtonElement>(`[aria-label="${next} ${column === 0 ? "horas" : "minutos"}"]`)
                        ?.focus();
                    }}
                  >
                    {option}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
