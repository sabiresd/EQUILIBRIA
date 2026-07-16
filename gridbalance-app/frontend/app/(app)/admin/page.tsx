"use client";

import * as React from "react";
import {
  CheckCircle2,
  Pencil,
  Plug,
  Plus,
  Server,
  Settings,
  Trash2,
  Users,
  XCircle,
} from "lucide-react";

import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/states";
import { toast } from "@/components/ui/use-toast";
import { api, errorMessage } from "@/lib/api";
import { useAdminConfig, useAdminUsers, usePermissions } from "@/lib/hooks";
import { AdminUserInputSchema, type AdminConfig, type AdminUser, type TestServiceResult } from "@/lib/schemas";
import { ROLE_LABELS, WORKFLOW_IDS, WORKFLOW_LABELS, type Role, type WorkflowId } from "@/lib/types";
import { fmtMs } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/*                            Utilisateurs (CRUD)                              */
/* -------------------------------------------------------------------------- */

const EMPTY_USER = {
  email: "",
  name: "",
  role: "operator" as Role,
  active: true,
  password: "",
};

function UserDialog({
  user,
  open,
  onOpenChange,
  onSaved,
}: {
  user: AdminUser | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const editing = !!user;
  const [draft, setDraft] = React.useState(EMPTY_USER);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<unknown>(null);

  React.useEffect(() => {
    if (!open) return;
    setErrors({});
    setError(null);
    setDraft(
      user
        ? { email: user.email, name: user.name, role: user.role, active: user.active, password: "" }
        : EMPTY_USER,
    );
  }, [open, user]);

  const save = async () => {
    setError(null);

    // A la creation, le mot de passe est obligatoire ; a l'edition il est optionnel.
    const parsed = AdminUserInputSchema.safeParse(draft);
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      parsed.error.issues.forEach((i) => {
        const k = i.path.join(".");
        if (!errs[k]) errs[k] = i.message;
      });
      setErrors(errs);
      return;
    }
    if (!editing && !draft.password) {
      setErrors({ password: "Le mot de passe est obligatoire a la creation." });
      return;
    }
    setErrors({});
    setSaving(true);

    try {
      if (editing && user) {
        await api.admin.users.update(user.id, parsed.data);
      } else {
        await api.admin.users.create(parsed.data);
      }
      toast({
        variant: "success",
        title: editing ? "Utilisateur mis a jour" : "Utilisateur cree",
        description: `${parsed.data.name} — ${ROLE_LABELS[parsed.data.role]}.`,
      });
      onOpenChange(false);
      onSaved();
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? "Modifier l'utilisateur" : "Nouvel utilisateur"}</DialogTitle>
          <DialogDescription>
            Le role determine les droits dans l&apos;application. Le backend applique la regle a
            chaque appel.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="u-name">Nom</Label>
            <Input
              id="u-name"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              aria-invalid={!!errors.name}
            />
            {errors.name ? (
              <p role="alert" className="text-xs text-red-300">
                {errors.name}
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="u-email">Adresse e-mail</Label>
            <Input
              id="u-email"
              type="email"
              value={draft.email}
              onChange={(e) => setDraft({ ...draft, email: e.target.value })}
              aria-invalid={!!errors.email}
            />
            {errors.email ? (
              <p role="alert" className="text-xs text-red-300">
                {errors.email}
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="u-role">Role</Label>
            <Select
              value={draft.role}
              onValueChange={(v) => setDraft({ ...draft, role: v as Role })}
            >
              <SelectTrigger id="u-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="operator">Operateur — lance et propose</SelectItem>
                <SelectItem value="supervisor">Superviseur — valide (HITL)</SelectItem>
                <SelectItem value="admin">Administrateur — tout</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="u-password">
              Mot de passe {editing ? "(laisser vide pour conserver)" : ""}
            </Label>
            <Input
              id="u-password"
              type="password"
              autoComplete="new-password"
              value={draft.password}
              onChange={(e) => setDraft({ ...draft, password: e.target.value })}
              aria-invalid={!!errors.password}
            />
            {errors.password ? (
              <p role="alert" className="text-xs text-red-300">
                {errors.password}
              </p>
            ) : null}
          </div>

          <div className="flex items-center justify-between rounded-lg border border-hairline/[0.07] bg-hairline/[0.02] px-3 py-2.5">
            <Label htmlFor="u-active" className="cursor-pointer">
              Compte actif
            </Label>
            <Switch
              id="u-active"
              checked={draft.active}
              onCheckedChange={(checked) => setDraft({ ...draft, active: checked })}
            />
          </div>

          {error ? <ErrorState error={error} compact /> : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button onClick={save} loading={saving}>
            {editing ? "Enregistrer" : "Creer l'utilisateur"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UsersPanel() {
  const { users, error, isLoading, mutate } = useAdminUsers();
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<AdminUser | null>(null);
  const [confirmDelete, setConfirmDelete] = React.useState<AdminUser | null>(null);
  const [deleting, setDeleting] = React.useState(false);

  const remove = async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      await api.admin.users.remove(confirmDelete.id);
      await mutate();
      toast({
        variant: "success",
        title: "Utilisateur supprime",
        description: `${confirmDelete.name} n'a plus acces a l'application.`,
      });
      setConfirmDelete(null);
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Suppression impossible",
        description: errorMessage(err),
      });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div className="space-y-1">
          <CardTitle>Utilisateurs</CardTitle>
          <CardDescription>Gestion des comptes et des roles.</CardDescription>
        </div>
        <Button
          onClick={() => {
            setEditing(null);
            setDialogOpen(true);
          }}
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Nouvel utilisateur
        </Button>
      </CardHeader>

      <CardContent>
        {isLoading && !users ? (
          <TableSkeleton rows={4} cols={5} />
        ) : error ? (
          <ErrorState error={error} onRetry={() => mutate()} />
        ) : users?.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nom</TableHead>
                <TableHead>E-mail</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium text-foreground">{u.name}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {u.email}
                  </TableCell>
                  <TableCell>
                    <Badge variant={u.role === "admin" ? "default" : "neutral"}>
                      {ROLE_LABELS[u.role]}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={u.active ? "success" : "neutral"}>
                      {u.active ? "Actif" : "Desactive"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => {
                          setEditing(u);
                          setDialogOpen(true);
                        }}
                        aria-label={`Modifier ${u.name}`}
                      >
                        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => setConfirmDelete(u)}
                        aria-label={`Supprimer ${u.name}`}
                        className="hover:text-red-300"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <EmptyState
            title="Aucun utilisateur"
            description="Creez le premier compte pour donner acces a l'application."
            icon={Users}
          />
        )}
      </CardContent>

      <UserDialog
        user={editing}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSaved={() => mutate()}
      />

      {/* Confirmation de suppression */}
      <Dialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Supprimer cet utilisateur ?</DialogTitle>
            <DialogDescription>
              {confirmDelete?.name} ({confirmDelete?.email}) perdra immediatement l&apos;acces.
              Cette action est tracee dans le journal d&apos;audit.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDelete(null)}>
              Annuler
            </Button>
            <Button variant="destructive" onClick={remove} loading={deleting}>
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              Supprimer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/*                         Configuration + tests service                       */
/* -------------------------------------------------------------------------- */

/** Services testables : les 4 workflows + Mongo + SMTP. */
const SERVICES: { key: string; label: string }[] = [
  ...WORKFLOW_IDS.map((id) => ({ key: id, label: `${id} — ${WORKFLOW_LABELS[id]}` })),
  { key: "mongo", label: "MongoDB — journal des decisions" },
  { key: "smtp", label: "SMTP — envoi des rapports" },
];

function ConfigPanel() {
  const { config, error, isLoading, mutate } = useAdminConfig();

  const [draft, setDraft] = React.useState<AdminConfig | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [testing, setTesting] = React.useState<string | null>(null);
  const [results, setResults] = React.useState<Record<string, TestServiceResult>>({});

  React.useEffect(() => {
    if (config) setDraft(config);
  }, [config]);

  const dirty = !!draft && !!config && JSON.stringify(draft) !== JSON.stringify(config);

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const saved = await api.admin.config.update(draft);
      await mutate(saved, { revalidate: false });
      toast({
        variant: "success",
        title: "Configuration enregistree",
        description: "Les nouveaux parametres sont actifs.",
      });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Enregistrement impossible",
        description: errorMessage(err),
      });
    } finally {
      setSaving(false);
    }
  };

  const test = async (service: string) => {
    setTesting(service);
    try {
      const result = await api.admin.test(service);
      setResults((r) => ({ ...r, [service]: result }));
      toast({
        variant: result.ok ? "success" : "destructive",
        title: result.ok ? `${service} joignable` : `${service} injoignable`,
        description:
          result.detail ??
          (result.ok
            ? `Reponse en ${fmtMs(result.latency_ms ?? null)}.`
            : "Le service n'a pas repondu."),
      });
    } catch (err) {
      setResults((r) => ({
        ...r,
        [service]: { service, ok: false, latency_ms: null, detail: errorMessage(err) },
      }));
      toast({
        variant: "destructive",
        title: `Test de ${service} impossible`,
        description: errorMessage(err),
      });
    } finally {
      setTesting(null);
    }
  };

  if (isLoading && !config) return <TableSkeleton rows={6} cols={2} />;
  if (error || !draft) return <ErrorState error={error} onRetry={() => mutate()} />;

  return (
    <div className="space-y-6">
      {/* ------------------------------------------------------- workflows */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Server className="h-4 w-4 text-emerald-400" aria-hidden="true" />
            URL des workflows
          </CardTitle>
          <CardDescription>
            Points d&apos;entree appeles par le backend. Le navigateur ne les appelle jamais
            directement.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {WORKFLOW_IDS.map((id: WorkflowId) => (
            <div key={id} className="space-y-2">
              <Label htmlFor={`wf-${id}`}>
                {id} — {WORKFLOW_LABELS[id]}
              </Label>
              <Input
                id={`wf-${id}`}
                type="url"
                value={draft.workflows[id]}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    workflows: { ...draft.workflows, [id]: e.target.value },
                  })
                }
                placeholder="https://…/webhook/…"
                className="font-mono text-xs"
              />
            </div>
          ))}
        </CardContent>
      </Card>

      {/* ------------------------------------------------------------ SMTP */}
      <Card>
        <CardHeader>
          <CardTitle>SMTP</CardTitle>
          <CardDescription>Serveur d&apos;envoi des rapports et notifications.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="smtp-host">Hote</Label>
            <Input
              id="smtp-host"
              value={draft.smtp.host}
              onChange={(e) =>
                setDraft({ ...draft, smtp: { ...draft.smtp, host: e.target.value } })
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="smtp-port">Port</Label>
            <Input
              id="smtp-port"
              type="number"
              min="1"
              max="65535"
              value={draft.smtp.port}
              onChange={(e) =>
                setDraft({ ...draft, smtp: { ...draft.smtp, port: Number(e.target.value) } })
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="smtp-user">Utilisateur</Label>
            <Input
              id="smtp-user"
              value={draft.smtp.user}
              onChange={(e) =>
                setDraft({ ...draft, smtp: { ...draft.smtp, user: e.target.value } })
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="smtp-from">Expediteur</Label>
            <Input
              id="smtp-from"
              type="email"
              value={draft.smtp.from}
              onChange={(e) =>
                setDraft({ ...draft, smtp: { ...draft.smtp, from: e.target.value } })
              }
            />
          </div>
          <div className="flex items-center justify-between rounded-lg border border-hairline/[0.07] bg-hairline/[0.02] px-3 py-2.5 sm:col-span-2">
            <Label htmlFor="smtp-tls" className="cursor-pointer">
              Chiffrement TLS
            </Label>
            <Switch
              id="smtp-tls"
              checked={draft.smtp.tls}
              onCheckedChange={(checked) =>
                setDraft({ ...draft, smtp: { ...draft.smtp, tls: checked } })
              }
            />
          </div>
        </CardContent>
      </Card>

      {/* ------------------------------------------------------- seuils */}
      <Card>
        <CardHeader>
          <CardTitle>Seuils d&apos;alerte</CardTitle>
          <CardDescription>
            Les regles detaillees sont gerables depuis la page Alertes.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="cfg-deficit">Seuil de deficit (MW)</Label>
            <Input
              id="cfg-deficit"
              type="number"
              min="0"
              value={draft.thresholds.deficit_mw}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  thresholds: { ...draft.thresholds, deficit_mw: Number(e.target.value) },
                })
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cfg-soc">Seuil de SoC (0–1)</Label>
            <Input
              id="cfg-soc"
              type="number"
              step="0.01"
              min="0"
              max="1"
              value={draft.thresholds.soc_min}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  thresholds: { ...draft.thresholds, soc_min: Number(e.target.value) },
                })
              }
            />
          </div>
        </CardContent>
      </Card>

      {/* Barre d'enregistrement */}
      <div className="sticky bottom-4 flex justify-end gap-2 rounded-xl border border-hairline/[0.07] bg-base-800/90 p-3 backdrop-blur">
        <Button variant="ghost" onClick={() => config && setDraft(config)} disabled={!dirty}>
          Annuler les modifications
        </Button>
        <Button onClick={save} loading={saving} disabled={!dirty}>
          Enregistrer la configuration
        </Button>
      </div>

      {/* ------------------------------------------------ tests de connexion */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plug className="h-4 w-4 text-emerald-400" aria-hidden="true" />
            Tests de connexion
          </CardTitle>
          <CardDescription>
            Verifiez la joignabilite de chaque service depuis le backend.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="divide-y divide-hairline/[0.05]">
            {SERVICES.map((svc) => {
              const result = results[svc.key];
              return (
                <li
                  key={svc.key}
                  className="flex flex-wrap items-center justify-between gap-3 py-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">{svc.label}</p>
                    {result ? (
                      <p
                        className={`mt-0.5 flex items-center gap-1.5 text-xs ${
                          result.ok ? "text-emerald-300" : "text-red-300"
                        }`}
                      >
                        {result.ok ? (
                          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                        ) : (
                          <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                        )}
                        {result.ok ? "Joignable" : "Injoignable"}
                        {result.latency_ms != null ? ` · ${fmtMs(result.latency_ms)}` : ""}
                        {result.detail ? ` · ${result.detail}` : ""}
                      </p>
                    ) : null}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => test(svc.key)}
                    loading={testing === svc.key}
                  >
                    Tester la connexion
                  </Button>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

export default function AdminPage() {
  const { canAdmin, role } = usePermissions();

  // Garde-fou d'interface. Le backend refuse de toute facon les appels non autorises.
  if (role && !canAdmin) {
    return (
      <>
        <PageHeader title="Administration" />
        <Card>
          <CardContent className="p-6">
            <EmptyState
              title="Acces reserve aux administrateurs"
              description="Votre role ne vous autorise pas a gerer les utilisateurs et la configuration."
              icon={Settings}
            />
          </CardContent>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Administration"
        description="Comptes, roles, configuration des services et tests de connexion."
      />

      <Tabs defaultValue="users">
        <TabsList>
          <TabsTrigger value="users">
            <Users className="h-3.5 w-3.5" aria-hidden="true" />
            Utilisateurs
          </TabsTrigger>
          <TabsTrigger value="config">
            <Settings className="h-3.5 w-3.5" aria-hidden="true" />
            Configuration
          </TabsTrigger>
        </TabsList>

        <TabsContent value="users">
          <UsersPanel />
        </TabsContent>

        <TabsContent value="config">
          <ConfigPanel />
        </TabsContent>
      </Tabs>
    </>
  );
}
