import { useRef, useState } from "react";
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
import { useBusinessCopy } from "@/business/use-business-copy";
import { formatBusinessCopy } from "@shared/business/copy/types";

type Props = {
  categories: ServiceCategoryWithCount[];
  isLoading: boolean;
  isError: boolean;
};

export function ServiceCategoriesManager({ categories, isLoading, isError }: Props) {
  const { toast } = useToast();
  const adminCopy = useBusinessCopy().admin;
  const copy = adminCopy.categories;
  const [isManagerOpen, setIsManagerOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState("");
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const pendingActionRef = useRef<string | null>(null);

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["/api/service-categories"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/services"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/admin/audit-logs"] }),
    ]);
  };

  const runAction = async (key: string, action: () => Promise<void>, successMessage: string) => {
    if (pendingActionRef.current) return;
    pendingActionRef.current = key;
    setPendingAction(key);
    try {
      await action();
      await refresh();
      toast({ title: adminCopy.common.successTitle, description: successMessage });
    } catch (error: any) {
      toast({
        title: adminCopy.common.errorTitle,
        description: error?.message || copy.updateError,
        variant: "destructive",
      });
    } finally {
      pendingActionRef.current = null;
      setPendingAction(null);
    }
  };

  const createCategory = async () => {
    const name = newName.trim();
    if (!name) return;
    await runAction("create", async () => {
      await apiRequest("POST", "/api/service-categories", { name });
      setNewName("");
    }, copy.created);
  };

  const saveName = async (category: ServiceCategoryWithCount) => {
    const name = editingName.trim();
    if (!name || name === category.name) return;
    await runAction(`rename-${category.id}`, async () => {
      await apiRequest("PATCH", `/api/service-categories/${category.id}`, { name });
      setEditingId(null);
      setEditingName("");
    }, copy.renamed);
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
    }, copy.reordered);
  };

  return (
    <Dialog
      open={isManagerOpen}
      onOpenChange={(open) => {
        if (!open && pendingActionRef.current) return;
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
          {copy.manage}
        </Button>
      </DialogTrigger>
      <DialogContent className="grid max-h-[85vh] w-[calc(100%-2rem)] max-w-3xl grid-rows-[auto_minmax(0,1fr)] overflow-hidden border-white/10 bg-card text-white">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription className="text-gray-400">
            {copy.description}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 overflow-y-auto p-1" data-testid="service-categories-manager">
          {isLoading && (
            <div className="mb-3 flex items-center gap-2 text-sm text-gray-400">
              <Loader2 className="h-4 w-4 animate-spin text-primary" aria-label={copy.loadingAria} />
              {copy.loading}
            </div>
          )}

          {isError ? (
            <p className="text-sm text-red-300">{copy.loadError}</p>
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
              placeholder={copy.newPlaceholder}
              className="border-white/10 bg-background text-white"
              aria-label={copy.newNameAria}
            />
            <Button
              variant="outline"
              className="gap-2"
              disabled={!newName.trim() || pendingAction !== null || isLoading || isError}
              onClick={() => void createCategory()}
            >
              {pendingAction === "create" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              {copy.create}
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
                    <span className="text-xs text-gray-400">{formatBusinessCopy(copy.serviceCount, {
                      count: category.serviceCount,
                      label: category.serviceCount === 1 ? copy.serviceCountSingular : copy.serviceCountPlural,
                    })}</span>
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
                      aria-label={formatBusinessCopy(copy.editAria, { name: category.name })}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      {copy.edit}
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8"
                      disabled={index === 0 || pendingAction !== null}
                      onClick={() => void moveCategory(index, -1)}
                      title={copy.moveUp}
                      aria-label={formatBusinessCopy(copy.moveUpAria, { name: category.name })}
                    >
                      <ChevronUp className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8"
                      disabled={index === categories.length - 1 || pendingAction !== null}
                      onClick={() => void moveCategory(index, 1)}
                      title={copy.moveDown}
                      aria-label={formatBusinessCopy(copy.moveDownAria, { name: category.name })}
                    >
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                    <label className="flex items-center gap-2 text-xs text-gray-300">
                      <Switch
                        checked={category.isActive}
                        disabled={pendingAction !== null}
                        aria-label={formatBusinessCopy(
                          category.isActive ? copy.deactivateAria : copy.activateAria,
                          { name: category.name },
                        )}
                        onCheckedChange={(isActive) => void runAction(`toggle-${category.id}`, async () => {
                          await apiRequest("PATCH", `/api/service-categories/${category.id}`, { isActive });
                        }, isActive ? copy.activated : copy.deactivated)}
                      />
                      {category.isActive ? copy.active : copy.inactive}
                    </label>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-red-400 hover:text-red-300" aria-label={formatBusinessCopy(copy.deleteAria, { name: category.name })}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent className="border-white/10 bg-card text-white">
                        <AlertDialogHeader>
                          <AlertDialogTitle>{formatBusinessCopy(copy.deleteTitle, { name: category.name })}</AlertDialogTitle>
                          <AlertDialogDescription className="text-gray-400">
                            {copy.deleteDescription}
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel className="border-white/10 bg-background text-white hover:bg-white/10">{adminCopy.common.cancel}</AlertDialogCancel>
                          <AlertDialogAction
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            onClick={() => void runAction(`delete-${category.id}`, async () => {
                              await apiRequest("DELETE", `/api/service-categories/${category.id}`);
                            }, copy.deleted)}
                          >
                            {copy.deleteAction}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              ))}
                </div>
              ) : (
                !isLoading && <p className="mt-4 text-sm text-gray-400">{copy.empty}</p>
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
                  <DialogTitle>{copy.editTitle}</DialogTitle>
                  <DialogDescription className="sr-only">
                    {copy.editDescription}
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
                      {copy.nameLabel}
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
                      {adminCopy.common.cancel}
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
                      {copy.save}
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
