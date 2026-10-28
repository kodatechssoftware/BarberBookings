import { useCallback, useEffect, useRef, useState } from "react";
import type { AvailabilitySocialVisualSettings } from "@/lib/availability-social-image";
import {
  createAvailabilitySocialPreset,
  createDefaultAvailabilitySocialSettings,
  deleteAvailabilitySocialBackground,
  loadAvailabilitySocialBackground,
  loadAvailabilitySocialPresets,
  optimizeAvailabilitySocialBackground,
  persistAvailabilitySocialPresets,
  saveAvailabilitySocialBackground,
  type AvailabilitySocialPreset,
} from "@/lib/availability-social-presets";

export function useAvailabilitySocialCustomization() {
  const [settings, setSettingsState] = useState<AvailabilitySocialVisualSettings>(createDefaultAvailabilitySocialSettings);
  const [presets, setPresets] = useState<AvailabilitySocialPreset[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  const [backgroundImageUrl, setBackgroundImageUrl] = useState("");
  const [isBackgroundProcessing, setIsBackgroundProcessing] = useState(false);
  const objectUrlRef = useRef("");
  const loadEpochRef = useRef(0);

  const replaceObjectUrl = useCallback((url: string) => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = url;
    setBackgroundImageUrl(url);
  }, []);

  const applySettings = useCallback(async (next: AvailabilitySocialVisualSettings, presetId: string | null = null) => {
    const epoch = ++loadEpochRef.current;
    setSettingsState(next);
    setSelectedPresetId(presetId);
    if (!next.backgroundImageId) {
      replaceObjectUrl("");
      return;
    }
    try {
      const blob = await loadAvailabilitySocialBackground(next.backgroundImageId);
      if (epoch !== loadEpochRef.current) return;
      replaceObjectUrl(blob ? URL.createObjectURL(blob) : "");
    } catch {
      if (epoch === loadEpochRef.current) replaceObjectUrl("");
    }
  }, [replaceObjectUrl]);

  useEffect(() => {
    const stored = loadAvailabilitySocialPresets();
    setPresets(stored);
    const defaultPreset = stored.find((preset) => preset.isDefault);
    if (defaultPreset) void applySettings(defaultPreset.settings, defaultPreset.id);
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, [applySettings]);

  const updateSettings = useCallback((patch: Partial<AvailabilitySocialVisualSettings>) => {
    setSelectedPresetId(null);
    setSettingsState((current) => ({ ...current, ...patch }));
  }, []);

  const importBackground = useCallback(async (file: File) => {
    setIsBackgroundProcessing(true);
    try {
      const previousId = settings.backgroundImageId;
      const blob = await optimizeAvailabilitySocialBackground(file);
      const id = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      await saveAvailabilitySocialBackground(id, blob);
      replaceObjectUrl(URL.createObjectURL(blob));
      setSelectedPresetId(null);
      setSettingsState((current) => ({
        ...current,
        backgroundImageId: id,
        backgroundImageName: file.name.slice(0, 120),
        backgroundPositionX: 50,
        backgroundPositionY: 50,
        backgroundZoom: 1,
      }));
      if (previousId && previousId !== id && !presets.some((preset) => preset.settings.backgroundImageId === previousId)) {
        await deleteAvailabilitySocialBackground(previousId).catch(() => undefined);
      }
      return { originalBytes: file.size, optimizedBytes: blob.size };
    } finally {
      setIsBackgroundProcessing(false);
    }
  }, [presets, replaceObjectUrl, settings.backgroundImageId]);

  const removeBackground = useCallback(async () => {
    const previousId = settings.backgroundImageId;
    replaceObjectUrl("");
    updateSettings({ backgroundImageId: null, backgroundImageName: null, backgroundPositionX: 50, backgroundPositionY: 50, backgroundZoom: 1 });
    if (previousId && !presets.some((preset) => preset.settings.backgroundImageId === previousId)) {
      await deleteAvailabilitySocialBackground(previousId).catch(() => undefined);
    }
  }, [presets, replaceObjectUrl, settings.backgroundImageId, updateSettings]);

  const savePreset = useCallback((name: string) => {
    if (!name.trim()) throw new Error("Indique um nome para o modelo.");
    const preset = createAvailabilitySocialPreset(name, settings, presets);
    const next = preset.isDefault
      ? [preset, ...presets.map((item) => ({ ...item, isDefault: false }))]
      : [preset, ...presets];
    persistAvailabilitySocialPresets(next);
    setPresets(next);
    setSelectedPresetId(preset.id);
    return preset;
  }, [presets, settings]);

  const setDefaultPreset = useCallback((id: string) => {
    const next = presets.map((preset) => ({ ...preset, isDefault: preset.id === id }));
    persistAvailabilitySocialPresets(next);
    setPresets(next);
  }, [presets]);

  const deletePreset = useCallback(async (id: string) => {
    const removed = presets.find((preset) => preset.id === id);
    const remaining = presets.filter((preset) => preset.id !== id);
    if (removed?.isDefault && remaining.length > 0) remaining[0] = { ...remaining[0], isDefault: true };
    persistAvailabilitySocialPresets(remaining);
    setPresets(remaining);
    const removedActivePreset = selectedPresetId === id;
    if (removedActivePreset) await applySettings(createDefaultAvailabilitySocialSettings());
    const backgroundId = removed?.settings.backgroundImageId;
    const backgroundRemainsInEditor = !removedActivePreset && settings.backgroundImageId === backgroundId;
    if (backgroundId && !backgroundRemainsInEditor && !remaining.some((preset) => preset.settings.backgroundImageId === backgroundId)) {
      await deleteAvailabilitySocialBackground(backgroundId).catch(() => undefined);
    }
  }, [applySettings, presets, selectedPresetId, settings.backgroundImageId]);

  const selectPreset = useCallback(async (preset: AvailabilitySocialPreset) => {
    const previousId = settings.backgroundImageId;
    await applySettings(preset.settings, preset.id);
    if (previousId && previousId !== preset.settings.backgroundImageId && !presets.some((item) => item.settings.backgroundImageId === previousId)) {
      await deleteAvailabilitySocialBackground(previousId).catch(() => undefined);
    }
  }, [applySettings, presets, settings.backgroundImageId]);

  const resetToOriginal = useCallback(async () => {
    const previousId = settings.backgroundImageId;
    await applySettings(createDefaultAvailabilitySocialSettings(settings.template));
    if (previousId && !presets.some((preset) => preset.settings.backgroundImageId === previousId)) {
      await deleteAvailabilitySocialBackground(previousId).catch(() => undefined);
    }
  }, [applySettings, presets, settings.backgroundImageId, settings.template]);

  return {
    settings,
    backgroundImageUrl,
    presets,
    selectedPresetId,
    isBackgroundProcessing,
    updateSettings,
    importBackground,
    removeBackground,
    savePreset,
    selectPreset,
    setDefaultPreset,
    deletePreset,
    resetToOriginal,
  };
}
