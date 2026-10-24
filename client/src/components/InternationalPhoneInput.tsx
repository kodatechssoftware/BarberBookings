import { useState, type FocusEventHandler } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  PHONE_COUNTRIES,
  formatPhoneInput,
  getPhoneCountry,
  splitStoredPhone,
  type PhoneCountryCode,
} from "@shared/phone-countries";

type InternationalPhoneInputProps = {
  id?: string;
  value: string;
  countryCode: PhoneCountryCode;
  onValueChange: (value: string, countryCode: PhoneCountryCode) => void;
  onBlur?: FocusEventHandler<HTMLInputElement>;
  countryAriaLabel?: string;
  inputAriaLabel?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
  autoComplete?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  inputClassName?: string;
  countryButtonClassName?: string;
};

export function InternationalPhoneInput({
  id,
  value,
  countryCode,
  onValueChange,
  onBlur,
  countryAriaLabel = "Selecionar país e indicativo",
  inputAriaLabel,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedBy,
  autoComplete = "tel",
  disabled = false,
  required = false,
  className,
  inputClassName,
  countryButtonClassName,
}: InternationalPhoneInputProps) {
  const [countryPickerOpen, setCountryPickerOpen] = useState(false);
  const country = getPhoneCountry(countryCode);

  const handleValueChange = (nextValue: string) => {
    const formattedValue = formatPhoneInput(nextValue, countryCode);
    const isInternational = formattedValue.trim().startsWith("+") || formattedValue.trim().startsWith("00");
    const detected = isInternational ? splitStoredPhone(formattedValue, countryCode).countryCode : countryCode;
    onValueChange(formattedValue, detected);
  };

  return (
    <div
      className={cn(
        "flex min-w-0 overflow-hidden rounded-md border bg-background focus-within:ring-1",
        ariaInvalid
          ? "border-red-500 focus-within:border-red-500 focus-within:ring-red-500"
          : "border-white/10 focus-within:border-primary focus-within:ring-primary",
        disabled && "cursor-not-allowed opacity-50",
        className,
      )}
    >
      <Popover open={countryPickerOpen} onOpenChange={setCountryPickerOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            role="combobox"
            aria-expanded={countryPickerOpen}
            aria-label={countryAriaLabel}
            disabled={disabled}
            className={cn(
              "flex h-full min-h-10 w-[126px] shrink-0 items-center gap-2 border-r border-white/10 px-3 text-left text-sm font-medium outline-none hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary",
              countryButtonClassName,
            )}
          >
            <span aria-hidden="true">{country.flag}</span>
            <span className="min-w-0 flex-1 truncate">{country.dialCode}</span>
            <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-60" aria-hidden="true" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[min(22rem,calc(100vw-2rem))] p-0"
        >
          <Command>
            <CommandInput placeholder="Pesquisar país ou indicativo..." aria-label="Pesquisar país ou indicativo" />
            <CommandList>
              <CommandEmpty>Nenhum país encontrado.</CommandEmpty>
              <CommandGroup>
                {PHONE_COUNTRIES.map((option) => (
                  <CommandItem
                    key={option.code}
                    value={`${option.label} ${option.dialCode} ${option.code}`}
                    onSelect={() => {
                      onValueChange(value, option.code);
                      setCountryPickerOpen(false);
                    }}
                  >
                    <Check
                      className={cn("h-4 w-4", option.code === countryCode ? "opacity-100" : "opacity-0")}
                      aria-hidden="true"
                    />
                    <span aria-hidden="true">{option.flag}</span>
                    <span className="min-w-0 flex-1 truncate">{option.label}</span>
                    <span className="shrink-0 text-muted-foreground">{option.dialCode}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      <Input
        id={id}
        type="tel"
        inputMode="tel"
        autoComplete={autoComplete}
        disabled={disabled}
        required={required}
        value={value}
        onChange={(event) => handleValueChange(event.currentTarget.value)}
        onBlur={onBlur}
        placeholder={country.placeholder}
        aria-label={inputAriaLabel}
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
        className={cn(
          "h-full min-h-10 min-w-0 flex-1 rounded-none border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0",
          inputClassName,
        )}
      />
    </div>
  );
}
