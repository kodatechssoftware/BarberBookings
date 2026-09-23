import { useState } from "react";
import { ChevronDown, ChevronUp, Loader2, Plus, Trash2 } from "lucide-react";
import type { ServiceCategoryWithCount } from "@shared/routes";
import { Button } from "@/components/ui/button-custom";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type Props = {
  categories: ServiceCategoryWithCount[];
  isLoading: boolean;
  isError: boolean;
};

export function ServiceCategoriesManager({ categories, isLoading, isError }: Props) {
  const { toast } = useToast();
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState("");
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["/api/service-categories"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/services"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/admin/audit-logs"] }),
    ]);
  };

  const runAction = async (key: string, action: () => Promise<void>, successMessage: string) => {
    setPendingAction(key);
    try {
      await action();
      await refresh();
      toast({ title: "Sucesso", description: successMessage });
    } catch (error: any) {
      toast({
        title: "Erro",
        description: error?.message || "Não foi possível atualizar as categorias.",
        variant: "destructive",
      });
    } finally {
      setPendingAction(null);
    }
  };

  const createCategory = async () => {
    const name = newName.trim();
    if (!name) return;
    await runAction("create", async () => {
      await apiRequest("POST", "/api/service-categories", { name });
      setNewName("");
    }, "Categoria criada.");
  };

  const saveName = async (category: ServiceCategoryWithCount) => {
    const name = editingName.trim();
    if (!name || name === category.name) {
      setEditingId(null);
      return;
    }
    await runAction(`rename-${category.id}`, async () => {
      await apiRequest("PATCH", `/api/service-categories/${category.id}`, { name });
      setEditingId(null);
    }, "Categoria renomeada.");
  };

  const moveCategory = async (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= categories.length) return;
    const orderedIds = categories.map((category) => category.id);
    [orderedIds[index], orderedIds[target]] = [orderedIds[target], orderedIds[index]];
    await runAction("reorder", async () => {
      await apiRequest("PUT", "/api/service-categories/order", { categoryIds: orderedIds });
    }, "Ordem das categorias atualizada.");
  };

  return (
    <div className="mb-6 rounded-xl border border-white/10 bg-card p-4 md:p-5" data-testid="service-categories-manager">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="font-bold text-white">Categorias de serviços</h3>
          <p className="text-xs text-gray-400">Organize a apresentação no site e no formulário de marcação. É opcional.</p>
        </div>
        {isLoading && <Loader2 className="h-4 w-4 animate-spin text-primary" aria-label="A carregar categorias" />}
      </div>

      {isError ? (
        <p className="mt-4 text-sm text-red-300">Não foi possível carregar as categorias.</p>
      ) : (
        <>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <Input
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void createCategory();
                }
              }}
              maxLength={80}
              placeholder="Nova categoria"
              className="border-white/10 bg-background text-white"
              aria-label="Nome da nova categoria"
            />
            <Button
              variant="outline"
              className="gap-2"
              disabled={!newName.trim() || pendingAction !== null || isLoading || isError}
              onClick={() => void createCategory()}
            >
              {pendingAction === "create" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Criar categoria
            </Button>
          </div>

          {categories.length > 0 && (
            <div className="mt-4 space-y-2">
              {categories.map((category, index) => (
                <div key={category.id} className="flex flex-col gap-3 rounded-lg border border-white/10 bg-background/50 p-3 lg:flex-row lg:items-center">
                  <div className="min-w-0 flex-1">
                    {editingId === category.id ? (
                      <div className="flex gap-2">
                        <Input
                          value={editingName}
                          onChange={(event) => setEditingName(event.target.value)}
                          maxLength={80}
                          className="h-9 border-white/10 bg-background text-white"
                          aria-label={`Novo nome de ${category.name}`}
                        />
                        <Button size="sm" variant="gold" onClick={() => void saveName(category)}>Guardar</Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>Cancelar</Button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="text-left"
                        onClick={() => {
                          setEditingId(category.id);
                          setEditingName(category.name);
                        }}
                      >
                        <span className="block font-medium text-white">{category.name}</span>
                        <span className="text-xs text-gray-400">{category.serviceCount} {category.serviceCount === 1 ? "serviço associado" : "serviços associados"}</span>
                      </button>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8"
                      disabled={index === 0 || pendingAction !== null}
                      onClick={() => void moveCategory(index, -1)}
                      aria-label={`Subir ${category.name}`}
                    >
                      <ChevronUp className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8"
                      disabled={index === categories.length - 1 || pendingAction !== null}
                      onClick={() => void moveCategory(index, 1)}
                      aria-label={`Descer ${category.name}`}
                    >
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                    <label className="flex items-center gap-2 text-xs text-gray-300">
                      <Switch
                        checked={category.isActive}
                        disabled={pendingAction !== null}
                        onCheckedChange={(isActive) => void runAction(`toggle-${category.id}`, async () => {
                          await apiRequest("PATCH", `/api/service-categories/${category.id}`, { isActive });
                        }, isActive ? "Categoria ativada." : "Categoria desativada.")}
                      />
                      {category.isActive ? "Ativa" : "Inativa"}
                    </label>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-red-400 hover:text-red-300" aria-label={`Eliminar ${category.name}`}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent className="border-white/10 bg-card text-white">
                        <AlertDialogHeader>
                          <AlertDialogTitle>Eliminar {category.name}?</AlertDialogTitle>
                          <AlertDialogDescription className="text-gray-400">
                            Os {category.serviceCount} serviços associados não serão eliminados; ficarão sem categoria.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel className="border-white/10 bg-background text-white hover:bg-white/10">Voltar</AlertDialogCancel>
                          <AlertDialogAction
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            onClick={() => void runAction(`delete-${category.id}`, async () => {
                              await apiRequest("DELETE", `/api/service-categories/${category.id}`);
                            }, "Categoria eliminada. Os serviços ficaram sem categoria.")}
                          >
                            Eliminar categoria
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
