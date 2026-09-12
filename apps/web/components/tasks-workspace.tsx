"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { tasksUi } from "../lib/i18n";
import { CrmAlert } from "./crm/alert";
import { taskChannel, taskChannelIcons } from "../lib/task-channel";

type User = { id: string; displayName: string; role: string };
type Attachment = { id: string; path: string };
type Task = {
  id: string;
  columnId: string;
  title: string;
  description?: string;
  type: "CLIENT" | "ADMINISTRATIVE" | "PRODUCTION";
  markerColor: string;
  labels: string[];
  dueAt?: string;
  archivedAt?: string;
  client?: { id: string; displayName: string; source?: string; preferredChannel?: string };
  assignee?: User;
  attachments: Attachment[];
  sourceMessage?: { content: string; conversation: { channel: string } };
};
type Column = {
  id: string;
  name: string;
  color: string;
  isDone: boolean;
  sortOrder: number;
  tasks: Task[];
};
type Board = { columns: Column[]; users: User[] };
function taskAccessibleLabel(task: Task) {
  const client = task.client
    ? `, ${tasksUi.client}: ${task.client.displayName}`
    : "";
  const channel = taskChannel(task);
  const source = channel
    ? `, ${tasksUi.clientChannel}: ${tasksUi.sources[channel]}`
    : "";
  return `${tasksUi.openTask}: ${task.title}${client}${source}`;
}
function TaskClientBadge({ task }: { task: Task }) {
  if (!task.client) return null;
  const channel = taskChannel(task);
  return <div className="task-client">{channel && <span className={`task-client-channel source-${channel.toLowerCase()}`} title={tasksUi.sources[channel]} aria-label={`${tasksUi.clientChannel}: ${tasksUi.sources[channel]}`}>{taskChannelIcons[channel]}</span>}<b>{task.client.displayName}</b></div>;
}
type Incoming = {
  id: string;
  content: string;
  createdAt: string;
  taskCreated: boolean;
  conversation: {
    channel: string;
    client: { id: string; displayName: string };
  };
};

async function api(path: string, init?: RequestInit) {
  const response = await fetch(`/api${path}`, {
    credentials: "include",
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(
      Array.isArray(body.message)
        ? body.message.join(", ")
        : body.message || tasksUi.actionError,
    );
  }
  return response.json();
}

export function TasksWorkspace() {
  const [data, setData] = useState<Board>({ columns: [], users: [] }),
    [view, setView] = useState<"compact" | "visual">("compact"),
    [search, setSearch] = useState(""),
    [assignee, setAssignee] = useState(""),
    [label, setLabel] = useState(""),
    [showArchived, setShowArchived] = useState(false),
    [archivedTask, setArchivedTask] = useState<Task>(),
    [error, setError] = useState(""),
    [editing, setEditing] = useState<Partial<Task> & { columnId?: string }>(),
    [incoming, setIncoming] = useState<Incoming[] | null>(null),
    [columnEditor, setColumnEditor] = useState<Partial<Column>>(),
    [saving, setSaving] = useState(false),
    dragged = useRef<string | undefined>(undefined),
    contextActionHandled=useRef(false);
  async function load(archived = showArchived) {
    try {
      setData(await api(`/tasks/board?archived=${archived}`));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    load(false);
  }, []);
  useEffect(()=>{if(contextActionHandled.current||!data.columns.length)return;const params=new URLSearchParams(window.location.search);if(params.get("action")!=="new")return;const clientId=params.get("clientId"),clientName=params.get("clientName");if(!clientId)return;contextActionHandled.current=true;setEditing({columnId:data.columns[0]?.id,type:"CLIENT",markerColor:"#7047eb",labels:[],client:{id:clientId,displayName:clientName||tasksUi.client}});clearContextAction()},[data.columns]);
  const labels = useMemo(
    () =>
      [
        ...new Set(
          data.columns.flatMap((c) => c.tasks.flatMap((t) => t.labels)),
        ),
      ].sort(),
    [data],
  );
  const shown = (tasks: Task[]) =>
    tasks.filter(
      (t) =>
        (!search ||
          `${t.title} ${t.description || ""} ${t.client?.displayName || ""}`
            .toLocaleLowerCase("ru")
            .includes(search.toLocaleLowerCase("ru"))) &&
        (!assignee || t.assignee?.id === assignee) &&
        (!label || t.labels.includes(label)),
    );
  const all = data.columns.flatMap((c) => c.tasks),
    overdue = all.filter(
      (t) =>
        t.dueAt &&
        new Date(t.dueAt) < new Date() &&
        !data.columns.find((c) => c.id === t.columnId)?.isDone,
    ).length;
  async function openIncoming() {
    try {
      setIncoming(await api("/tasks/incoming"));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function newAdmin() {
    setEditing({
      columnId: data.columns[0]?.id,
      type: "ADMINISTRATIVE",
      markerColor: "#e49a34",
      labels: [tasksUi.procurement],
      assignee: data.users.find((u) => u.role === "ADMIN"),
    });
  }
  async function move(taskId: string, columnId: string, position?: number) {
    try {
      await api(`/tasks/${taskId}/move`, {
        method: "PATCH",
        body: JSON.stringify({
          columnId,
          ...(position === undefined ? {} : { position }),
        }),
      });
      await load();
    } catch (e) {
      setError((e as Error).message);
      await load();
    }
  }
  return (
    <section className="phase2-main tasks-page">
      <header className="phase2-header">
        <div>
          <p>{tasksUi.eyebrow}</p>
          <h1>{tasksUi.title}</h1>
          <span>{tasksUi.subtitle}</span>
        </div>
        <div className="tasks-header-actions">
          {!showArchived && (
            <>
              <button onClick={openIncoming}>{tasksUi.fromInbox}</button>
              <button onClick={newAdmin}>{tasksUi.forAdministrator}</button>
              <button
                className="phase2-primary"
                onClick={() =>
                  setEditing({
                    columnId: data.columns[0]?.id,
                    type: "CLIENT",
                    markerColor: "#7047eb",
                    labels: [],
                  })
                }
              >
                {tasksUi.newTask}
              </button>
            </>
          )}
        </div>
      </header>
      {error && (
        <CrmAlert>{error}</CrmAlert>
      )}
      <div className="tasks-stats">
        <span>
          {tasksUi.total}
          <b>{all.length}</b>
        </span>
        <span>
          {tasksUi.inWork}
          <b>
            {
              data.columns.filter((c) => !c.isDone).flatMap((c) => c.tasks)
                .length
            }
          </b>
        </span>
        <span>
          {tasksUi.overdue}
          <b>{overdue}</b>
        </span>
        <span>
          {tasksUi.done}
          <b>
            {
              data.columns.filter((c) => c.isDone).flatMap((c) => c.tasks)
                .length
            }
          </b>
        </span>
      </div>
      <div className="tasks-toolbar">
        <input
          aria-label={tasksUi.search}
          placeholder={tasksUi.search}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          aria-label={tasksUi.assignee}
          value={assignee}
          onChange={(e) => setAssignee(e.target.value)}
        >
          <option value="">{tasksUi.allAssignees}</option>
          {data.users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.displayName}
            </option>
          ))}
        </select>
        <select
          aria-label={tasksUi.label}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        >
          <option value="">{tasksUi.allLabels}</option>
          {labels.map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
        <div className="tasks-view">
          <button
            className={view === "compact" ? "active" : ""}
            onClick={() => setView("compact")}
          >
            {tasksUi.compactView}
          </button>
          <button
            className={view === "visual" ? "active" : ""}
            onClick={() => setView("visual")}
          >
            {tasksUi.visualView}
          </button>
        </div>
        <button
          className={showArchived ? "active" : ""}
          aria-pressed={showArchived}
          onClick={async () => {
            const next = !showArchived;
            setShowArchived(next);
            await load(next);
          }}
        >
          {showArchived ? tasksUi.activeTasks : tasksUi.archivedTasks}
        </button>
        {!showArchived && (
          <button
            onClick={() =>
              setColumnEditor({
                color: "#7047eb",
                sortOrder: data.columns.length,
              })
            }
          >
            {tasksUi.addColumn}
          </button>
        )}
      </div>
      <div className="tasks-board-wrap">
        <div className={`tasks-board ${view}`}>
          {data.columns.map((column) => (
            <section
              className="tasks-column"
              key={column.id}
              onDragOver={(e) => !showArchived && e.preventDefault()}
              onDrop={() =>
                !showArchived &&
                dragged.current &&
                move(dragged.current, column.id)
              }
            >
              <header style={{ borderColor: column.color }}>
                <span>
                  <i style={{ background: column.color }} />
                  {column.name}
                  <b>{shown(column.tasks).length}</b>
                </span>
                {!showArchived && (
                  <button
                    aria-label={tasksUi.editColumn}
                    onClick={() => setColumnEditor(column)}
                  >
                    •••
                  </button>
                )}
              </header>
              <div>
                {shown(column.tasks).map((task) => (
                  <article
                    className="task-card"
                    key={task.id}
                    role="button"
                    tabIndex={0}
                    aria-label={taskAccessibleLabel(task)}
                    draggable={!showArchived}
                    onDragStart={() => {
                      if (!showArchived) dragged.current = task.id;
                    }}
                    onDragEnd={() => {
                      dragged.current = undefined;
                    }}
                    onDragOver={(event) =>
                      !showArchived && event.preventDefault()
                    }
                    onDrop={(event) => {
                      event.stopPropagation();
                      if (
                        !showArchived &&
                        dragged.current &&
                        dragged.current !== task.id
                      ) {
                        const targetIndex = column.tasks
                          .filter((item) => item.id !== dragged.current)
                          .findIndex((item) => item.id === task.id);
                        const bounds = event.currentTarget.getBoundingClientRect();
                        const insertAfter =
                          event.clientY > bounds.top + bounds.height / 2;
                        const targetPosition = Math.max(
                          0,
                          targetIndex + (insertAfter ? 1 : 0),
                        );
                        move(
                          dragged.current,
                          column.id,
                          targetPosition,
                        );
                      }
                    }}
                    onClick={() =>
                      showArchived
                        ? setArchivedTask(task)
                        : setEditing(task)
                    }
                    onKeyDown={(event) => {
                      if (
                        (event.key === "Enter" || event.key === " ")
                      ) {
                        event.preventDefault();
                        showArchived
                          ? setArchivedTask(task)
                          : setEditing(task);
                      }
                    }}
                    style={{ borderLeftColor: task.markerColor }}
                  >
                    {task.attachments[0] && (
                      <img
                        className="task-card-thumb"
                        src={`/api/tasks/images/${task.attachments[0].path}`}
                        alt={`${tasksUi.taskPhoto}: ${task.title}`}
                      />
                    )}
                    <div className="task-card-body">
                      <span className="task-type">
                        {tasksUi.types[task.type]}
                      </span>
                      <h3>{task.title}</h3>
                      <TaskClientBadge task={task}/>
                      {task.description && <p>{task.description}</p>}
                      <div className="task-labels">
                        {task.labels.map((x) => (
                          <i key={x}>{x}</i>
                        ))}
                      </div>
                      <footer>
                        <span>
                          {task.assignee?.displayName || tasksUi.notAssigned}
                        </span>
                        {task.dueAt && (
                          <time
                            className={
                              new Date(task.dueAt) < new Date() ? "late" : ""
                            }
                          >
                            {new Date(task.dueAt).toLocaleDateString("ru-RU")}
                          </time>
                        )}
                      </footer>
                    </div>
                  </article>
                ))}
                {!shown(column.tasks).length && (
                  <p className="tasks-empty">
                    {showArchived
                      ? tasksUi.emptyArchiveColumn
                      : tasksUi.emptyColumn}
                  </p>
                )}
              </div>
            </section>
          ))}
        </div>
      </div>
      {editing && (
        <TaskDialog
          task={editing}
          columns={data.columns}
          users={data.users}
          saving={saving}
          close={() => !saving && setEditing(undefined)}
          save={async (payload) => {
            try {
              setSaving(true);
              const values = payload as Record<string, unknown>;
              await api(editing.id ? `/tasks/${editing.id}` : "/tasks", {
                method: editing.id ? "PATCH" : "POST",
                body: JSON.stringify(payload),
              });
              if (editing.id && values.columnId !== editing.columnId)
                await api(`/tasks/${editing.id}/move`, {
                  method: "PATCH",
                  body: JSON.stringify({ columnId: values.columnId }),
                });
              setEditing(undefined);
              await load();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setSaving(false);
            }
          }}
          archive={
            editing.id
              ? async () => {
                  try {
                    setSaving(true);
                    await api(`/tasks/${editing.id}/archive`, {
                      method: "POST",
                    });
                    setEditing(undefined);
                    await load();
                  } finally {
                    setSaving(false);
                  }
                }
              : undefined
          }
        />
      )}
      {archivedTask && (
        <Dialog
          title={archivedTask.title}
          close={() => setArchivedTask(undefined)}
        >
          <div className="tasks-archived-detail">
            {archivedTask.attachments[0] && (
              <img
                src={`/api/tasks/images/${archivedTask.attachments[0].path}`}
                alt={`${tasksUi.taskPhoto}: ${archivedTask.title}`}
              />
            )}
            {archivedTask.description && <p>{archivedTask.description}</p>}
            <div className="task-labels">
              {archivedTask.labels.map((item) => (
                <i key={item}>{item}</i>
              ))}
            </div>
            <button onClick={() => setArchivedTask(undefined)}>
              {tasksUi.close}
            </button>
          </div>
        </Dialog>
      )}
      {incoming && (
        <IncomingDialog
          items={incoming}
          close={() => setIncoming(null)}
          choose={(item) => {
            setIncoming(null);
            setEditing({
              columnId: data.columns[0]?.id,
              type: "CLIENT",
              markerColor: "#7047eb",
              labels: [tasksUi.fromMessage],
              title: item.content.slice(0, 80),
              description: item.content,
              client: item.conversation.client,
              sourceMessage: {
                content: item.content,
                conversation: { channel: item.conversation.channel },
              },
              sourceMessageId: item.id,
            } as Partial<Task> & { sourceMessageId: string });
          }}
        />
      )}
      {columnEditor && (
        <ColumnDialog
          column={columnEditor}
          saving={saving}
          close={() => !saving && setColumnEditor(undefined)}
          save={async (payload) => {
            try {
              setSaving(true);
              await api(
                columnEditor.id
                  ? `/tasks/columns/${columnEditor.id}`
                  : "/tasks/columns",
                {
                  method: columnEditor.id ? "PATCH" : "POST",
                  body: JSON.stringify(payload),
                },
              );
              setColumnEditor(undefined);
              await load();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setSaving(false);
            }
          }}
          archive={
            columnEditor.id
              ? async () => {
                  try {
                    setSaving(true);
                    await api(`/tasks/columns/${columnEditor.id}/archive`, {
                      method: "POST",
                    });
                    setColumnEditor(undefined);
                    await load();
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setSaving(false);
                  }
                }
              : undefined
          }
        />
      )}
    </section>
  );
}

function clearContextAction(){const url=new URL(window.location.href);for(const key of["action","clientId","clientName","orderId"])url.searchParams.delete(key);window.history.replaceState(null,"",url)}

export function TaskDialog({
  task,
  columns,
  users,
  saving,
  close,
  save,
  archive,
}: {
  task: Partial<Task> & { sourceMessageId?: string };
  columns: Column[];
  users: User[];
  saving: boolean;
  close: () => void;
  save: (x: object) => Promise<void>;
  archive?: () => Promise<void>;
}) {
  const [files, setFiles] = useState<string[]>([]);
  const previewPaths=[...(task.attachments?.map((attachment) => attachment.path)||[]),...files];
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    await save({
      columnId: f.get("columnId"),
      title: f.get("title"),
      description: f.get("description"),
      type: f.get("type"),
      clientId: task.client?.id,
      sourceMessageId: task.sourceMessageId,
      assigneeId: f.get("assigneeId") || undefined,
      dueAt: f.get("dueAt")
        ? new Date(String(f.get("dueAt")) + "T12:00:00Z").toISOString()
        : null,
      markerColor: f.get("markerColor"),
      labels: String(f.get("labels") || "")
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean),
      attachmentPaths: files,
    });
  }
  async function upload(list: FileList | null) {
    if (!list) return;
    const added: string[] = [];
    for (const file of Array.from(list)) {
      const data = await readFile(file);
      const result = await api("/tasks/images", {
        method: "POST",
        body: JSON.stringify({ name: file.name, mime: file.type, data }),
      });
      added.push(result.path);
    }
    setFiles((x) => [...x, ...added]);
  }
  return (
    <Dialog title={task.id ? tasksUi.editTask : tasksUi.newTask} close={close}>
      <form className="task-form" onSubmit={submit}>
        <label>
          {tasksUi.titleField}
          <input
            name="title"
            required
            maxLength={180}
            defaultValue={task.title}
            autoFocus
          />
        </label>
        <label>
          {tasksUi.description}
          <textarea
            name="description"
            rows={4}
            defaultValue={task.description}
          />
        </label>
        <div className="task-form-grid">
          <label>
            {tasksUi.type}
            <select name="type" defaultValue={task.type || "CLIENT"}>
              {Object.entries(tasksUi.types).map(([v, n]) => (
                <option value={v} key={v}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label>
            {tasksUi.column}
            <select name="columnId" defaultValue={task.columnId}>
              {columns.map((c) => (
                <option value={c.id} key={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {tasksUi.assignee}
            <select name="assigneeId" defaultValue={task.assignee?.id || ""}>
              <option value="">{tasksUi.notAssigned}</option>
              {users.map((u) => (
                <option value={u.id} key={u.id}>
                  {u.displayName}
                </option>
              ))}
            </select>
          </label>
          <label>
            {tasksUi.deadline}
            <input
              type="date"
              name="dueAt"
              defaultValue={task.dueAt?.slice(0, 10)}
            />
          </label>
          <label>
            {tasksUi.marker}
            <input
              type="color"
              name="markerColor"
              defaultValue={task.markerColor || "#7047eb"}
            />
          </label>
          <label>
            {tasksUi.labels}
            <input
              name="labels"
              defaultValue={task.labels?.join(", ")}
              placeholder={tasksUi.labelsHint}
            />
          </label>
        </div>
        <label>
          {tasksUi.photos}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            onChange={(e) => upload(e.target.files)}
          />
          {files.length > 0 && (
            <small>
              {tasksUi.selectedPhotos}: {files.length}
            </small>
          )}
        </label>
        {previewPaths.length > 0 && (
          <div className="task-form-previews" aria-label={tasksUi.photoPreviews}>
            {previewPaths.map((path) => <img key={path} src={`/api/tasks/images/${path}`} alt={tasksUi.photoPreviews}/>) }
          </div>
        )}
        {task.client && (
          <p className="task-context">
            {tasksUi.client}: <b>{task.client.displayName}</b>
          </p>
        )}
        <footer>
          {archive && (
            <button type="button" className="danger" onClick={archive}>
              {tasksUi.archive}
            </button>
          )}
          <span />
          <button type="button" onClick={close}>
            {tasksUi.cancel}
          </button>
          <button className="phase2-primary" disabled={saving}>
            {saving ? tasksUi.saving : tasksUi.save}
          </button>
        </footer>
      </form>
    </Dialog>
  );
}
function IncomingDialog({
  items,
  close,
  choose,
}: {
  items: Incoming[];
  close: () => void;
  choose: (x: Incoming) => void;
}) {
  return (
    <Dialog title={tasksUi.incomingTitle} close={close}>
      <div className="tasks-incoming">
        {items.map((x) => (
          <button key={x.id} disabled={x.taskCreated} onClick={() => choose(x)}>
            <b>{x.conversation.client.displayName}</b>
            <span>{x.content}</span>
            <small>
              {x.taskCreated
                ? tasksUi.alreadyTask
                : new Date(x.createdAt).toLocaleString("ru-RU")}
            </small>
          </button>
        ))}
        {!items.length && <p>{tasksUi.noIncoming}</p>}
      </div>
    </Dialog>
  );
}
function ColumnDialog({
  column,
  saving,
  close,
  save,
  archive,
}: {
  column: Partial<Column>;
  saving: boolean;
  close: () => void;
  save: (x: object) => Promise<void>;
  archive?: () => Promise<void>;
}) {
  return (
    <Dialog
      title={column.id ? tasksUi.editColumn : tasksUi.addColumn}
      close={close}
    >
      <form
        className="task-form"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          save({
            name: f.get("name"),
            color: f.get("color"),
            isDone: f.get("isDone") === "on",
            sortOrder: column.sortOrder,
          });
        }}
      >
        <label>
          {tasksUi.columnName}
          <input
            name="name"
            required
            maxLength={80}
            defaultValue={column.name}
            autoFocus
          />
        </label>
        <label>
          {tasksUi.columnColor}
          <input
            type="color"
            name="color"
            defaultValue={column.color || "#7047eb"}
          />
        </label>
        <label className="task-checkbox">
          <input type="checkbox" name="isDone" defaultChecked={column.isDone} />
          {tasksUi.completesTasks}
        </label>
        <footer>
          {archive && (
            <button type="button" className="danger" onClick={archive}>
              {tasksUi.archiveColumn}
            </button>
          )}
          <span />
          <button type="button" onClick={close}>
            {tasksUi.cancel}
          </button>
          <button className="phase2-primary" disabled={saving}>
            {tasksUi.save}
          </button>
        </footer>
      </form>
    </Dialog>
  );
}
function Dialog({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
}) {
  const panel = useRef<HTMLElement>(null),
    previous = useRef<HTMLElement | null>(null),
    closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    previous.current = document.activeElement as HTMLElement;
    const controls = () =>
      Array.from(
        panel.current?.querySelectorAll<HTMLElement>(
          "button,input,select,textarea",
        ) || [],
      ).filter((x) => !x.hasAttribute("disabled"));
    controls()[0]?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
      if (e.key === "Tab") {
        const a = controls(),
          first = a[0],
          last = a[a.length - 1];
        if (!first || !last) return;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      previous.current?.focus();
    };
  }, []);
  return (
    <div
      className="finance-overlay"
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <section
        ref={panel}
        className="finance-modal tasks-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tasks-dialog-title"
      >
        <header>
          <h2 id="tasks-dialog-title">{title}</h2>
          <button onClick={close} aria-label={tasksUi.close}>
            ×
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
function readFile(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
