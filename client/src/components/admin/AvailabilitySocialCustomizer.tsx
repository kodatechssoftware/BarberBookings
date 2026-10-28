import { useState } from "react";
import { Check, ImagePlus, RotateCcw, Save, Star, Trash2, X } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button-custom";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import type { AvailabilitySocialScheduleLayout, AvailabilitySocialVisualSettings } from "@/lib/availability-social-image";
import type { AvailabilitySocialPreset } from "@/lib/availability-social-presets";

type AvailabilitySocialCustomizerProps = {
  settings: AvailabilitySocialVisualSettings;
  presets: AvailabilitySocialPreset[];
  selectedPresetId: string | null;
  isBackgroundProcessing: boolean;
  onChange: (patch: Partial<AvailabilitySocialVisualSettings>) => void;
  onImportBackground: (file: File) => Promise<void>;
  onRemoveBackground: () => Promise<void>;
  onSavePreset: (name: string) => void;
  onSelectPreset: (preset: AvailabilitySocialPreset) => Promise<void>;
  onSetDefaultPreset: (id: string) => void;
  onDeletePreset: (id: string) => Promise<void>;
  onReset: () => void;
};

const scheduleLayouts: Array<{ value: AvailabilitySocialScheduleLayout; label: string; description: string }> = [
  { value: "balanced", label: "Equilibrado", description: "Grelha versátil para qualquer número de vagas" },
  { value: "stacked", label: "Em lista", description: "Mais destaque vertical quando existem poucas vagas" },
  { value: "compact", label: "Compacto", description: "Mais horários por linha" },
];

export default function AvailabilitySocialCustomizer({
  settings,
  presets,
  selectedPresetId,
  isBackgroundProcessing,
  onChange,
  onImportBackground,
  onRemoveBackground,
  onSavePreset,
  onSelectPreset,
  onSetDefaultPreset,
  onDeletePreset,
  onReset,
}: AvailabilitySocialCustomizerProps) {
  const [presetName, setPresetName] = useState("");
  const [deletePresetId, setDeletePresetId] = useState<string | null>(null);
  const presetToDelete = presets.find((preset) => preset.id === deletePresetId);

  return (
    <div className="space-y-6">
      <section className="space-y-3 rounded-xl border border-white/10 bg-background/35 p-4">
        <div>
          <p className="font-semibold text-white">Imagem de fundo</p>
          <p className="mt-1 text-xs leading-relaxed text-gray-400">JPG, PNG ou WebP até 10 MB. A imagem é otimizada antes de ser guardada neste dispositivo.</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Label htmlFor="promotion-background" className="inline-flex min-h-10 cursor-pointer items-center justify-center rounded-md border border-white/15 px-4 text-sm font-medium text-white hover:bg-white/5">
            <ImagePlus className="mr-2 h-4 w-4" /> {isBackgroundProcessing ? "A otimizar…" : "Importar imagem"}
          </Label>
          <input
            id="promotion-background"
            aria-label="Importar imagem de fundo"
            className="sr-only"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={isBackgroundProcessing}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file) void onImportBackground(file);
            }}
          />
          {settings.backgroundImageId && (
            <Button type="button" variant="outline" onClick={() => void onRemoveBackground()}>
              <X className="mr-2 h-4 w-4" /> Remover fundo
            </Button>
          )}
        </div>
        {settings.backgroundImageName && <p className="truncate text-xs text-primary">{settings.backgroundImageName}</p>}

        {settings.backgroundImageId && (
          <div className="grid gap-4 pt-2 sm:grid-cols-2">
            <RangeControl label="Escurecimento" value={Math.round(settings.overlayOpacity * 100)} minimum={45} maximum={85} suffix="%" onChange={(value) => onChange({ overlayOpacity: value / 100 })} />
            <RangeControl label="Zoom" value={Math.round(settings.backgroundZoom * 100)} minimum={100} maximum={180} suffix="%" onChange={(value) => onChange({ backgroundZoom: value / 100 })} />
            <RangeControl label="Enquadramento horizontal" value={settings.backgroundPositionX} minimum={0} maximum={100} suffix="%" onChange={(value) => onChange({ backgroundPositionX: value })} />
            <RangeControl label="Enquadramento vertical" value={settings.backgroundPositionY} minimum={0} maximum={100} suffix="%" onChange={(value) => onChange({ backgroundPositionY: value })} />
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div>
          <p className="text-sm font-medium text-gray-200">Cores</p>
          <p className="mt-1 text-xs text-gray-500">O texto principal mantém contraste automático. Tons de destaque demasiado escuros são corrigidos no PNG.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <ColorControl label="Cor de destaque" value={settings.accentColor} onChange={(value) => onChange({ accentColor: value })} />
          <ColorControl label="Cor secundária" value={settings.secondaryColor} onChange={(value) => onChange({ secondaryColor: value })} />
        </div>
      </section>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-gray-200">Disposição dos horários</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {scheduleLayouts.map((layout) => {
            const active = settings.scheduleLayout === layout.value;
            return (
              <button
                key={layout.value}
                type="button"
                aria-pressed={active}
                onClick={() => onChange({ scheduleLayout: layout.value })}
                className={cn("relative rounded-xl border p-3 text-left transition-all", active ? "border-primary bg-primary/10" : "border-white/10 bg-background/50 hover:border-white/30")}
              >
                {active && <Check className="absolute right-2 top-2 h-4 w-4 text-primary" />}
                <span className="block pr-5 text-sm font-semibold text-white">{layout.label}</span>
                <span className="mt-1 block text-xs leading-relaxed text-gray-400">{layout.description}</span>
              </button>
            );
          })}
        </div>
      </fieldset>

      <section className="space-y-3 rounded-xl border border-primary/20 bg-primary/5 p-4">
        <div>
          <p className="font-semibold text-white">Modelos guardados</p>
          <p className="mt-1 text-xs leading-relaxed text-gray-400">Disponíveis apenas neste navegador nesta fase. Não incluem data, serviço, profissional ou horários.</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input aria-label="Nome do modelo" maxLength={50} value={presetName} onChange={(event) => setPresetName(event.target.value)} placeholder="Ex.: Sextas premium" />
          <Button type="button" variant="gold" onClick={() => { onSavePreset(presetName); setPresetName(""); }}>
            <Save className="mr-2 h-4 w-4" /> Guardar modelo
          </Button>
        </div>
        {presets.length === 0 ? (
          <p className="text-xs text-gray-500">Ainda não existem modelos personalizados.</p>
        ) : (
          <div className="space-y-2">
            {presets.map((preset) => (
              <div key={preset.id} className={cn("flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center", selectedPresetId === preset.id ? "border-primary/60 bg-primary/10" : "border-white/10 bg-background/40")}>
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => void onSelectPreset(preset)}>
                  <span className="block truncate font-medium text-white">{preset.name}</span>
                  <span className="text-xs text-gray-500">{preset.isDefault ? "Predefinido · " : ""}{preset.settings.backgroundImageName || "Sem imagem de fundo"}</span>
                </button>
                <div className="flex gap-2">
                  <Button type="button" size="sm" variant="outline" aria-label={`Definir ${preset.name} como predefinido`} disabled={preset.isDefault} onClick={() => onSetDefaultPreset(preset.id)}>
                    <Star className={cn("h-4 w-4", preset.isDefault && "fill-primary text-primary")} />
                  </Button>
                  <Button type="button" size="sm" variant="outline" aria-label={`Eliminar modelo ${preset.name}`} onClick={() => setDeletePresetId(preset.id)}>
                    <Trash2 className="h-4 w-4 text-red-300" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
        <Button type="button" variant="ghost" className="w-full" onClick={onReset}>
          <RotateCcw className="mr-2 h-4 w-4" /> Repor modelo original
        </Button>
      </section>

      <AlertDialog open={Boolean(deletePresetId)} onOpenChange={(open) => { if (!open) setDeletePresetId(null); }}>
        <AlertDialogContent className="border-white/10 bg-card text-white">
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar modelo personalizado?</AlertDialogTitle>
            <AlertDialogDescription className="text-gray-400">O modelo «{presetToDelete?.name}» deixa de estar disponível neste dispositivo. Esta ação não elimina marcações nem dados de disponibilidade.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-white/10 bg-background text-white hover:bg-white/10">Cancelar</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 text-white hover:bg-red-500" onClick={() => {
              if (deletePresetId) void onDeletePreset(deletePresetId);
              setDeletePresetId(null);
            }}>Eliminar modelo</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function RangeControl({ label, value, minimum, maximum, suffix, onChange }: { label: string; value: number; minimum: number; maximum: number; suffix: string; onChange: (value: number) => void }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 text-xs"><Label>{label}</Label><span className="text-gray-400">{Math.round(value)}{suffix}</span></div>
      <Slider aria-label={label} min={minimum} max={maximum} step={1} value={[value]} onValueChange={([next]) => onChange(next)} />
    </div>
  );
}

function ColorControl({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <Label className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-background/50 px-3 py-2">
      <span className="text-sm text-gray-200">{label}</span>
      <span className="flex items-center gap-2 text-xs text-gray-400">
        {value.toUpperCase()}
        <input aria-label={label} type="color" value={value} onChange={(event) => onChange(event.target.value.toUpperCase())} className="h-9 w-12 cursor-pointer rounded border border-white/10 bg-transparent p-0.5" />
      </span>
    </Label>
  );
}
