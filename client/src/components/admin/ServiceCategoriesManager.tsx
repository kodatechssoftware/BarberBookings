import { useState } from "react";
import { ChevronDown, ChevronUp, Loader2, Pencil, Plus, Tags, Trash2 } from "lucide-react";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type Props = {
  categories: ServiceCategoryWithCount[];
  isLoading: boolean;
  isError: boolean;
};

export function ServiceCategoriesManager({ categories, isLoading, isError }: Props) {
  const { toast } = useToast();
  const [isManagerOpen, setIsManagerOpen] = useState(false);
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
    if (!name || name === category.name) return;
    await runAction(`rename-${category.id}`, async () => {
      await apiRequest("PATCH", `/api/service-categories/${category.id}`, { name });
      setEditingId(null);
      setEditingName("");
    }, "Categoria renomeada.");
  };

  const closeEditDialog = () => {
    setEditingId(null);
    setEditingName("");
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
    <Dialog
      open={isManagerOpen}
      onOpenChange={(open) => {
        setIsManagerOpen(open);
        if (!open) {
          setNewName("");
          closeEditDialog();
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" className="w-full gap-2 sm:w-auto">
          <Tags className="h-4 w-4" />
          Gerir categorias
        </Button>
      </DialogTrigger>
      <DialogContent className="grid max-h-[85vh] w-[calc(100%-2rem)] max-w-3xl grid-rows-[auto_minmax(0,1fr)] overflow-hidden border-white/10 bg-card text-white">
        <DialogHeader>
          <DialogTitle>Gerir categorias</DialogTitle>
          <DialogDescription className="text-gray-400">
            Organize os serviços por categorias para facilitar a escolha nas marcações online.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 overflow-y-auto p-1" data-testid="service-categories-manager">
          {isLoading && (
            <div className="mb-3 flex items-center gap-2 text-sm text-gray-400">
              <Loader2 className="h-4 w-4 animate-spin text-primary" aria-label="A carregar categorias" />
              A carregar categorias...
            </div>
          )}

          {isError ? (
            <p className="text-sm text-red-300">Não foi possível carregar as categorias.</p>
          ) : (
            <>
              <div className="flex flex-col gap-2 sm:flex-row">
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

              {categories.length > 0 ? (
                <div className="mt-4 space-y-2">
              {categories.map((category, index) => (
                <div
                  key={category.id}
                  className="flex flex-col gap-3 rounded-lg border border-white/10 bg-background/50 p-3 lg:flex-row lg:items-center"
                  data-testid={`service-category-${category.id}`}
                >
                  <div className="min-w-0 flex-1">
                    <span className="block font-medium text-white">{category.name}</span>
                    <span className="text-xs text-gray-400">{category.serviceCount} {category.serviceCount === 1 ? "serviço associado" : "serviços associados"}</span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 gap-2"
                      disabled={pendingAction !== null}
                      onClick={() => {
                        setEditingId(category.id);
                        setEditingName(category.name);
                      }}
                      aria-label={`Editar ${category.name}`}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      Editar
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8"
                      disabled={index === 0 || pendingAction !== null}
                      onClick={() => void moveCategory(index, -1)}
                      title="Mover para cima"
                      aria-label={`Mover ${category.name} para cima`}
                    >
                      <ChevronUp className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8"
                      disabled={index === categories.length - 1 || pendingAction !== null}
                      onClick={() => void moveCategory(index, 1)}
                      title="Mover para baixo"
                      aria-label={`Mover ${category.name} para baixo`}
                    >
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                    <label className="flex items-center gap-2 text-xs text-gray-300">
                      <Switch
                        checked={category.isActive}
                        disabled={pendingAction !== null}
                        aria-label={`${category.isActive ? "Desativar" : "Ativar"} ${category.name}`}
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
                          <AlertDialogTitle>Eliminar a categoria “{category.name}”?</AlertDialogTitle>
                          <AlertDialogDescription className="text-gray-400">
                            Esta ação elimina apenas a categoria. Os serviços associados mantêm-se e ficam sem categoria.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel className="border-white/10 bg-background text-white hover:bg-white/10">Cancelar</AlertDialogCancel>
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
              ) : (
                !isLoading && <p className="mt-4 text-sm text-gray-400">Ainda não existem categorias.</p>
              )}

              {categories.map((category) => (
            <Dialog
              key={`edit-${category.id}`}
              open={editingId === category.id}
              onOpenChange={(open) => {
                if (!open) closeEditDialog();
              }}
            >
              <DialogContent className="max-w-md border-white/10 bg-card text-white">
                <DialogHeader>
                  <DialogTitle>Editar categoria</DialogTitle>
                  <DialogDescription className="sr-only">
                    Altere o nome apresentado para esta categoria de serviços.
                  </DialogDescription>
                </DialogHeader>
                <form
                  className="space-y-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void saveName(category);
                  }}
                >
                  <div className="space-y-2">
                    <label htmlFor={`service-category-name-${category.id}`} className="text-sm font-medium text-white">
                      Nome da categoria
                    </label>
                    <Input
                      id={`service-category-name-${category.id}`}
                      value={editingName}
                      onChange={(event) => setEditingName(event.target.value)}
                      maxLength={80}
                      required
                      autoFocus
                      className="border-white/10 bg-background text-white"
                    />
                  </div>
                  <DialogFooter>
                    <Button type="button" variant="outline" onClick={closeEditDialog}>
                      Cancelar
                    </Button>
                    <Button
                      type="submit"
                      variant="gold"
                      disabled={
                        !editingName.trim()
                        || editingName.trim() === category.name
                        || pendingAction !== null
                      }
                    >
                      {pendingAction === `rename-${category.id}` && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Guardar alterações
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
              ))}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
