import { useState, useEffect } from "react";

// ─── GitHub Storage Layer ──────────────────────────────────────────────────────
const DATA_PATH = "data/recipes.json";
const CFG_KEY   = "gitfood-config-v1";

const loadCfg = () => { try { return JSON.parse(localStorage.getItem(CFG_KEY)); } catch { return null; } };
const saveCfg = c => localStorage.setItem(CFG_KEY, JSON.stringify(c));

async function ghRead(cfg) {
  const { token, owner, repo } = cfg;
  const r = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${DATA_PATH}`,
    { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github.v3+json" } }
  );
  if (r.status === 404) return { recipes: [], sha: null };
  if (!r.ok) { const e = await r.json(); throw new Error(e.message || `GitHub error ${r.status}`); }
  const d = await r.json();
  const text = decodeURIComponent(escape(atob(d.content.replace(/\s/g, ""))));
  return { recipes: JSON.parse(text), sha: d.sha };
}

async function ghWrite(recipes, sha, cfg) {
  const { token, owner, repo } = cfg;
  const content = btoa(unescape(encodeURIComponent(JSON.stringify(recipes, null, 2))));
  const dt = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const body = {
    message: `🍴 recipe update · ${dt}`,
    content, branch: "main",
    ...(sha ? { sha } : {}),
  };
  const r = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${DATA_PATH}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );
  if (!r.ok) { const e = await r.json(); throw new Error(e.message || `GitHub error ${r.status}`); }
  const d = await r.json();
  return d.content.sha;
}

async function ghTest(cfg) {
  const { token, owner, repo } = cfg;
  const r = await fetch(
    `https://api.github.com/repos/${owner}/${repo}`,
    { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github.v3+json" } }
  );
  if (!r.ok) { const e = await r.json(); throw new Error(e.message || `Error ${r.status}`); }
}

// ─── App Constants ─────────────────────────────────────────────────────────────
const CATEGORIES = [
  { id: "all",       label: "All Recipes" },
  { id: "Appetizer", label: "Appetizers"  },
  { id: "MainDish",  label: "Main Dishes" },
  { id: "SideDish",  label: "Side Dishes" },
  { id: "Dessert",   label: "Desserts"    },
  { id: "Other",     label: "Others"      },
];
const CAT = {
  Appetizer: "Appetizers", MainDish: "Main Dishes",
  SideDish: "Side Dishes", Dessert: "Desserts", Other: "Others",
};

const genId   = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
const fmtDate = d => {
  try { return new Date(d + "T12:00:00").toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }); }
  catch { return d || ""; }
};

// ─── Root App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [cfg,      setCfg]      = useState(() => loadCfg());
  const [showSetup,setShowSetup]= useState(false);
  const [recipes,  setRecipes]  = useState([]);
  const [sha,      setSha]      = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState(null);
  const [category, setCategory] = useState("all");
  const [tag,      setTag]      = useState(null);
  const [search,   setSearch]   = useState("");
  const [view,     setView]     = useState("list");
  const [selected, setSelected] = useState(null);
  const [editing,  setEditing]  = useState(null);
  const [toast,    setToast]    = useState(null);

  // ── Load from GitHub ────────────────────────────────────────────────────
  useEffect(() => {
    if (!cfg) { setLoading(false); return; }
    setLoading(true); setError(null);
    ghRead(cfg)
      .then(({ recipes, sha }) => { setRecipes(recipes); setSha(sha); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [cfg]);

  function showToast(msg) { setToast(msg); setTimeout(() => setToast(null), 2800); }

  async function persist(next) {
    setSaving(true);
    try {
      const newSha = await ghWrite(next, sha, cfg);
      setRecipes(next); setSha(newSha);
      return true;
    } catch (e) {
      if (e.message.toLowerCase().includes("sha")) {
        // Conflict: reload current SHA and retry once
        try {
          const { sha: remoteSha } = await ghRead(cfg);
          const newSha2 = await ghWrite(next, remoteSha, cfg);
          setRecipes(next); setSha(newSha2);
          return true;
        } catch { /* fall through */ }
      }
      alert(`Save failed: ${e.message}`);
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function handleSave(data) {
    let next;
    if (data.id) {
      next = recipes.map(r => r.id === data.id ? data : r);
      if (selected?.id === data.id) setSelected(data);
    } else {
      const nr = { ...data, id: genId(), date: new Date().toISOString().split("T")[0] };
      next = [nr, ...recipes];
    }
    const ok = await persist(next);
    if (ok) { showToast(data.id ? "Recipe saved ✓" : "Recipe added ✓"); setEditing(null); }
  }

  async function handleDelete(id) {
    if (!window.confirm("Delete this recipe? This cannot be undone.")) return;
    const ok = await persist(recipes.filter(r => r.id !== id));
    if (ok) { setView("list"); setSelected(null); showToast("Recipe deleted."); }
  }

  function handleConnect(newCfg) {
    saveCfg(newCfg); setCfg(newCfg); setShowSetup(false);
  }

  function navTo(catId, tagId = null) {
    setCategory(catId); setTag(tagId);
    setView("list"); setSelected(null); setSearch("");
  }

  function reload() {
    setError(null); setLoading(true);
    ghRead(cfg)
      .then(({ recipes, sha }) => { setRecipes(recipes); setSha(sha); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }

  // ── Derived data ─────────────────────────────────────────────────────────
  const filtered = recipes.filter(r => {
    const byCat = category === "all" || r.category === category;
    const byTag = !tag  || (r.tags || []).includes(tag);
    const byQ   = !search
      || r.title.toLowerCase().includes(search.toLowerCase())
      || (r.description || "").toLowerCase().includes(search.toLowerCase());
    return byCat && byTag && byQ;
  });

  const grouped = CATEGORIES.slice(1).reduce((acc, c) => {
    const items = filtered.filter(r => r.category === c.id);
    if (items.length) acc[c.id] = items;
    return acc;
  }, {});

  const tagCounts = recipes.reduce((a, r) => {
    (r.tags || []).forEach(t => { a[t] = (a[t] || 0) + 1; });
    return a;
  }, {});

  const catCounts = CATEGORIES.reduce((a, c) => {
    a[c.id] = c.id === "all" ? recipes.length : recipes.filter(r => r.category === c.id).length;
    return a;
  }, {});

  // ── Screens ──────────────────────────────────────────────────────────────
  if (!cfg || showSetup) return (
    <SetupScreen
      existing={cfg}
      onConnect={handleConnect}
      onCancel={cfg ? () => setShowSetup(false) : null}
    />
  );

  if (loading) return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center",
      height:"100vh", fontFamily:"Georgia,serif", color:"#666",
      background:"#faf8f3", flexDirection:"column", gap:16 }}>
      <div style={{ fontSize:48 }}>🍴</div>
      <div>Loading your cookbook from GitHub…</div>
    </div>
  );

  if (error) return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center",
      height:"100vh", fontFamily:"system-ui,sans-serif", background:"#faf8f3",
      flexDirection:"column", gap:16, padding:40, textAlign:"center" }}>
      <div style={{ fontSize:48 }}>⚠️</div>
      <h2 style={{ color:"#333", fontFamily:"Georgia,serif" }}>Couldn't connect to GitHub</h2>
      <p style={{ color:"#777", maxWidth:420, lineHeight:1.6 }}>{error}</p>
      <div style={{ display:"flex", gap:12, marginTop:8 }}>
        <button onClick={reload}
          style={{ background:"#2a5934", color:"white", border:"none", borderRadius:6,
            padding:"10px 20px", cursor:"pointer", fontFamily:"system-ui,sans-serif", fontSize:14 }}>
          Try Again
        </button>
        <button onClick={() => setShowSetup(true)}
          style={{ background:"white", border:"1px solid #e8e4dc", borderRadius:6,
            padding:"10px 20px", cursor:"pointer", fontFamily:"system-ui,sans-serif", fontSize:14 }}>
          Edit Settings
        </button>
      </div>
    </div>
  );

  // ── Main UI ───────────────────────────────────────────────────────────────
  return (
    <div style={s.root}>
      <style>{CSS}</style>

      <header style={s.header}>
        <div style={s.hi}>
          <div style={s.logo} onClick={() => navTo("all")}>
            <span style={s.logoIcon}>🍴</span>
            <div>
              <div style={s.logoName}>GitFood</div>
              <div style={s.logoSub}>Exquisitely Managed Recipes</div>
            </div>
          </div>
          <div style={s.hRight}>
            {saving && <span style={s.savingBadge}>💾 Saving…</span>}
            <div style={s.searchWrap}>
              <span style={s.si}>🔍</span>
              <input className="gf-search" placeholder="Search recipes…"
                value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <button className="gf-add" onClick={() => setEditing({})}>+ Add Recipe</button>
            <button className="gf-settings" onClick={() => setShowSetup(true)} title="Settings">⚙️</button>
          </div>
        </div>
      </header>

      <div style={s.layout}>
        <nav style={s.sidebar}>
          <div style={s.navGroup}>
            {CATEGORIES.map(c => (
              <button key={c.id}
                className={`gf-nav${category === c.id && !tag ? " gf-nav-on" : ""}`}
                onClick={() => navTo(c.id)}>
                {c.label}
                <span style={s.badge}>{catCounts[c.id] || 0}</span>
              </button>
            ))}
          </div>

          {Object.keys(tagCounts).length > 0 && <>
            <div style={s.div} />
            <div style={s.navLabel}>Recipe Tags</div>
            <div style={s.tagCloud}>
              {Object.entries(tagCounts).map(([t, n]) => (
                <button key={t}
                  className={`gf-tag${tag === t ? " gf-tag-on" : ""}`}
                  onClick={() => navTo("all", tag === t ? null : t)}>
                  {t} <span style={{ opacity:.6, fontSize:11 }}>({n})</span>
                </button>
              ))}
            </div>
          </>}

          <div style={s.div} />
          <div style={s.repoBox}>
            <div style={s.repoStat}>📄 {recipes.length} Recipes</div>
            <div style={s.repoStat}>🏷️ {Object.keys(tagCounts).length} Tags</div>
            <div style={s.repoStat}>🔗 {cfg.owner}/{cfg.repo}</div>
          </div>
        </nav>

        <main style={s.main}>
          {view === "list" ? (
            <ListView
              filtered={filtered} grouped={grouped}
              category={category} tag={tag}
              onSelect={r => { setSelected(r); setView("detail"); }}
              onAdd={() => setEditing({})} />
          ) : view === "detail" && selected ? (
            <DetailView
              recipe={selected}
              saving={saving}
              onBack={() => { setView("list"); setSelected(null); }}
              onEdit={() => setEditing(selected)}
              onDelete={() => handleDelete(selected.id)} />
          ) : null}
        </main>
      </div>

      {editing !== null && (
        <RecipeForm
          recipe={editing?.id ? editing : null}
          categories={CATEGORIES.filter(c => c.id !== "all")}
          saving={saving}
          onSave={handleSave}
          onClose={() => setEditing(null)} />
      )}

      {toast && <div style={s.toast}>{toast}</div>}
    </div>
  );
}

// ─── Setup Screen ──────────────────────────────────────────────────────────────
function SetupScreen({ existing, onConnect, onCancel }) {
  const [owner,   setOwner]   = useState(existing?.owner || "");
  const [repo,    setRepo]    = useState(existing?.repo  || "food");
  const [token,   setToken]   = useState(existing?.token || "");
  const [testing, setTesting] = useState(false);
  const [err,     setErr]     = useState(null);

  async function connect() {
    if (!owner.trim() || !repo.trim() || !token.trim()) {
      setErr("Please fill in all three fields."); return;
    }
    const cfg = { owner: owner.trim(), repo: repo.trim(), token: token.trim() };
    setTesting(true); setErr(null);
    try {
      await ghTest(cfg);
      onConnect(cfg);
    } catch (e) {
      setErr(e.message);
    }
    setTesting(false);
  }

  return (
    <div style={{ minHeight:"100vh", background:"#faf8f3", display:"flex",
      alignItems:"center", justifyContent:"center", padding:24 }}>
      <style>{CSS}</style>
      <div style={{ background:"white", borderRadius:16, padding:"40px 48px",
        maxWidth:480, width:"100%", boxShadow:"0 8px 40px rgba(0,0,0,.12)" }}>
        <div style={{ textAlign:"center", marginBottom:32 }}>
          <div style={{ fontSize:52, marginBottom:12 }}>🍴</div>
          <h1 style={{ fontFamily:"'Playfair Display',Georgia,serif", fontSize:32,
            fontWeight:700, color:"#1a1a1a", marginBottom:8 }}>GitFood</h1>
          <p style={{ color:"#888", fontSize:15, fontFamily:"system-ui,sans-serif", lineHeight:1.5 }}>
            {existing ? "Update your GitHub connection settings." : "Connect to your GitHub repository to get started."}
          </p>
        </div>

        <div style={{ display:"flex", flexDirection:"column", gap:18 }}>
          <div>
            <label style={s.label}>GitHub Username</label>
            <input className="gf-inp" value={owner}
              onChange={e => setOwner(e.target.value)}
              placeholder="e.g. jondavid-black"
              style={{ marginTop:6 }} />
          </div>
          <div>
            <label style={s.label}>Repository Name</label>
            <input className="gf-inp" value={repo}
              onChange={e => setRepo(e.target.value)}
              placeholder="e.g. food"
              style={{ marginTop:6 }} />
          </div>
          <div>
            <label style={s.label}>Personal Access Token</label>
            <input className="gf-inp" type="password" value={token}
              onChange={e => setToken(e.target.value)}
              placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
              style={{ marginTop:6 }} />
            <div style={{ fontSize:12, color:"#999", marginTop:8,
              fontFamily:"system-ui,sans-serif", lineHeight:1.6, background:"#f8f7f4",
              borderRadius:6, padding:"10px 12px" }}>
              Create at: <strong>GitHub.com → Settings → Developer settings →
              Personal access tokens → Tokens (classic)</strong><br />
              Needs the <code style={{ background:"#e8e4dc", padding:"1px 5px",
              borderRadius:3, fontSize:11 }}>repo</code> scope checked.
            </div>
          </div>

          {err && (
            <div style={{ background:"#fdf0f0", border:"1px solid #f5c6c6",
              borderRadius:8, padding:"12px 16px", fontSize:14,
              color:"#c0392b", fontFamily:"system-ui,sans-serif" }}>
              ⚠️ {err}
            </div>
          )}

          <button style={{ ...s.saveBtn, width:"100%", padding:"13px", fontSize:15, marginTop:4 }}
            onClick={connect} disabled={testing}>
            {testing ? "Connecting…" : "Connect to GitHub"}
          </button>

          {onCancel && (
            <button style={{ ...s.cancelBtn, width:"100%", padding:"13px", fontSize:15 }}
              onClick={onCancel}>
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── List View ─────────────────────────────────────────────────────────────────
function ListView({ filtered, grouped, category, tag, onSelect, onAdd }) {
  const title = tag
    ? `Tagged: ${tag}`
    : CATEGORIES.find(c => c.id === category)?.label || "All Recipes";
  const showGrouped = category === "all" && !tag;

  if (filtered.length === 0) return (
    <div style={s.empty}>
      <div style={{ fontSize:60, marginBottom:16 }}>🍽️</div>
      <h3 style={s.emptyH}>No recipes found</h3>
      <p style={{ color:"#888", marginBottom:24, fontFamily:"system-ui,sans-serif", fontSize:15 }}>
        Add your first recipe to get started!</p>
      <button className="gf-add" onClick={onAdd}>+ Add Recipe</button>
    </div>
  );

  return (
    <div>
      <div style={s.pageHead}>
        <h1 style={s.pageTitle}>{title}</h1>
        <p style={{ fontSize:14, color:"#888", fontFamily:"system-ui,sans-serif" }}>
          {filtered.length} recipe{filtered.length !== 1 ? "s" : ""}
        </p>
      </div>
      {showGrouped
        ? Object.entries(grouped).map(([cid, items]) => (
            <div key={cid} style={{ marginBottom:40 }}>
              <h2 style={s.catH}>
                {CAT[cid]}
                <span style={{ fontSize:14, color:"#888", fontWeight:400 }}> ({items.length})</span>
              </h2>
              {items.map(r => <RecipeCard key={r.id} recipe={r} onSelect={onSelect} />)}
            </div>
          ))
        : filtered.map(r => <RecipeCard key={r.id} recipe={r} onSelect={onSelect} />)
      }
    </div>
  );
}

// ─── Recipe Card ───────────────────────────────────────────────────────────────
function RecipeCard({ recipe, onSelect }) {
  return (
    <div className="gf-card" onClick={() => onSelect(recipe)}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
        <span style={s.catLabel}>{CAT[recipe.category] || recipe.category}</span>
        <span style={s.dateLabel}>{fmtDate(recipe.date)}</span>
      </div>
      <h3 style={s.cardTitle}>{recipe.title}</h3>
      {recipe.description && (
        <p style={s.cardDesc}>
          {recipe.description.length > 160 ? recipe.description.slice(0, 160) + "…" : recipe.description}
        </p>
      )}
      <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
        {(recipe.tags || []).map(t => <span key={t} style={s.tagChip}>{t}</span>)}
        <span style={{ marginLeft:"auto", color:"#2a5934", fontSize:13,
          fontWeight:600, fontFamily:"system-ui,sans-serif" }}>
          Read Recipe →
        </span>
      </div>
    </div>
  );
}

// ─── Detail View ───────────────────────────────────────────────────────────────
function DetailView({ recipe, saving, onBack, onEdit, onDelete }) {
  return (
    <div style={s.detail}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:24 }}>
        <button className="gf-back" onClick={onBack}>← Back to Recipes</button>
        <div style={{ display:"flex", gap:8 }}>
          <button className="gf-edit-btn" onClick={onEdit} disabled={saving}>✏️ Edit</button>
          <button className="gf-del-btn"  onClick={onDelete} disabled={saving}>🗑️ Delete</button>
        </div>
      </div>

      <div style={{ display:"flex", gap:12, alignItems:"center", marginBottom:12, flexWrap:"wrap" }}>
        <span style={s.catLabel}>{CAT[recipe.category] || recipe.category}</span>
        <span style={s.dateLabel}>{fmtDate(recipe.date)}</span>
        {recipe.servings && <span style={s.dateLabel}>· Serves {recipe.servings}</span>}
      </div>

      <h1 style={s.detailTitle}>{recipe.title}</h1>

      {(recipe.tags || []).length > 0 && (
        <div style={{ marginBottom:24, display:"flex", gap:8, flexWrap:"wrap" }}>
          {recipe.tags.map(t => <span key={t} style={s.tagChip}>{t}</span>)}
        </div>
      )}

      {recipe.description && <p style={s.detailDesc}>{recipe.description}</p>}

      {(recipe.ingredients || []).length > 0 && (
        <div style={s.section}>
          <h2 style={s.sectionH}>Ingredients</h2>
          <ul style={{ listStyle:"disc", paddingLeft:22 }}>
            {recipe.ingredients.map((ing, i) => (
              <li key={i} style={{ fontSize:15, lineHeight:1.9, color:"#333" }}>{ing}</li>
            ))}
          </ul>
        </div>
      )}

      {(recipe.instructions || []).length > 0 && (
        <div style={s.section}>
          <h2 style={s.sectionH}>Instructions</h2>
          <ol style={{ listStyle:"decimal", paddingLeft:22 }}>
            {recipe.instructions.map((step, i) => (
              <li key={i} style={{ fontSize:15, lineHeight:1.8, color:"#333", marginBottom:10 }}>{step}</li>
            ))}
          </ol>
        </div>
      )}

      {recipe.notes && (
        <div style={s.notesBox}>
          <strong style={{ color:"#2a5934" }}>📝 Notes: </strong>{recipe.notes}
        </div>
      )}
    </div>
  );
}

// ─── Recipe Form ───────────────────────────────────────────────────────────────
function RecipeForm({ recipe, categories, saving, onSave, onClose }) {
  const [f, setF] = useState({
    id:           recipe?.id           || "",
    title:        recipe?.title        || "",
    category:     recipe?.category     || "MainDish",
    description:  recipe?.description  || "",
    tags:         (recipe?.tags        || []).join(", "),
    servings:     recipe?.servings     || "",
    ingredients:  (recipe?.ingredients || []).join("\n"),
    instructions: (recipe?.instructions|| []).join("\n"),
    notes:        recipe?.notes        || "",
    date:         recipe?.date         || new Date().toISOString().split("T")[0],
  });

  const upd = (k, v) => setF(p => ({ ...p, [k]: v }));

  function submit() {
    if (!f.title.trim()) { alert("Please enter a recipe title."); return; }
    onSave({
      id:           f.id || null,
      title:        f.title.trim(),
      category:     f.category,
      description:  f.description.trim(),
      tags:         f.tags.split(",").map(t => t.trim()).filter(Boolean),
      servings:     f.servings ? parseInt(f.servings) : null,
      ingredients:  f.ingredients.split("\n").map(l => l.trim()).filter(Boolean),
      instructions: f.instructions.split("\n").map(l => l.trim()).filter(Boolean),
      notes:        f.notes.trim(),
      date:         f.date,
    });
  }

  return (
    <div style={s.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={s.modal}>
        <div style={s.mHead}>
          <h2 style={s.mTitle}>{f.id ? "Edit Recipe" : "Add New Recipe"}</h2>
          <button style={s.xBtn} onClick={onClose}>✕</button>
        </div>

        <div style={s.mBody}>
          <FRow label="Recipe Title *">
            <input className="gf-inp" value={f.title}
              onChange={e => upd("title", e.target.value)}
              placeholder="e.g. Crawfish Étouffée" />
          </FRow>

          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>
            <FRow label="Category">
              <select className="gf-inp" value={f.category}
                onChange={e => upd("category", e.target.value)}>
                {categories.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </FRow>
            <FRow label="Servings">
              <input className="gf-inp" type="number" value={f.servings}
                onChange={e => upd("servings", e.target.value)} placeholder="e.g. 6" />
            </FRow>
          </div>

          <FRow label="Short Description">
            <textarea className="gf-inp gf-ta" rows={2} value={f.description}
              onChange={e => upd("description", e.target.value)}
              placeholder="A brief teaser that appears in the recipe list…" />
          </FRow>

          <FRow label="Tags" hint="comma-separated — e.g. Cajun, Seafood, American">
            <input className="gf-inp" value={f.tags}
              onChange={e => upd("tags", e.target.value)}
              placeholder="Cajun, Seafood, American" />
          </FRow>

          <FRow label="Ingredients" hint="one per line">
            <textarea className="gf-inp gf-ta" rows={5} value={f.ingredients}
              onChange={e => upd("ingredients", e.target.value)}
              placeholder={"2 cups shredded cheddar\n8 oz cream cheese\n½ cup mayo"} />
          </FRow>

          <FRow label="Instructions" hint="one step per line">
            <textarea className="gf-inp gf-ta" rows={6} value={f.instructions}
              onChange={e => upd("instructions", e.target.value)}
              placeholder={"Mix all ingredients.\nRefrigerate for 1 hour.\nServe with crackers."} />
          </FRow>

          <FRow label="Notes" hint="optional tips or variations">
            <textarea className="gf-inp gf-ta" rows={2} value={f.notes}
              onChange={e => upd("notes", e.target.value)}
              placeholder="Any extra tips or variations…" />
          </FRow>
        </div>

        <div style={s.mFoot}>
          <button style={s.cancelBtn} onClick={onClose}>Cancel</button>
          <button style={{ ...s.saveBtn, opacity: saving ? .7 : 1 }}
            onClick={submit} disabled={saving}>
            {saving ? "Saving to GitHub…" : (f.id ? "Save Changes" : "Add Recipe")}
          </button>
        </div>
      </div>
    </div>
  );
}

function FRow({ label, hint, children }) {
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
      <label style={{ fontSize:13, fontWeight:600, color:"#333", fontFamily:"system-ui,sans-serif" }}>
        {label}
        {hint && <span style={{ fontWeight:400, color:"#aaa", fontSize:12 }}> — {hint}</span>}
      </label>
      {children}
    </div>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────────
const G = "#2a5934", BORDER = "#e8e4dc";

const s = {
  root:       { fontFamily:"'Source Serif 4',Georgia,serif", background:"#faf8f3", minHeight:"100vh", color:"#1a1a1a" },
  header:     { background:"#1c2b1e", position:"sticky", top:0, zIndex:100, boxShadow:"0 2px 8px rgba(0,0,0,.25)" },
  hi:         { maxWidth:1120, margin:"0 auto", display:"flex", alignItems:"center", justifyContent:"space-between", padding:"12px 24px", gap:16 },
  logo:       { display:"flex", alignItems:"center", gap:12, cursor:"pointer" },
  logoIcon:   { fontSize:28 },
  logoName:   { fontFamily:"'Playfair Display',Georgia,serif", fontSize:24, fontWeight:700, color:"white", lineHeight:1.2 },
  logoSub:    { fontSize:11, color:"rgba(255,255,255,.5)", letterSpacing:".06em", fontFamily:"system-ui,sans-serif" },
  hRight:     { display:"flex", alignItems:"center", gap:12 },
  savingBadge:{ fontSize:12, color:"rgba(255,255,255,.7)", fontFamily:"system-ui,sans-serif", background:"rgba(255,255,255,.1)", padding:"4px 10px", borderRadius:20 },
  searchWrap: { position:"relative", display:"flex", alignItems:"center" },
  si:         { position:"absolute", left:10, fontSize:14, pointerEvents:"none" },
  layout:     { maxWidth:1120, margin:"0 auto", display:"flex", padding:"24px 24px", gap:32 },
  sidebar:    { width:210, flexShrink:0 },
  main:       { flex:1, minWidth:0 },
  navGroup:   { display:"flex", flexDirection:"column", gap:2 },
  navLabel:   { fontSize:11, fontWeight:700, color:"#999", textTransform:"uppercase", letterSpacing:".1em", marginBottom:8, fontFamily:"system-ui,sans-serif" },
  badge:      { marginLeft:"auto", background:"#e8e4dc", borderRadius:10, padding:"1px 7px", fontSize:12, color:"#888", fontFamily:"system-ui,sans-serif" },
  div:        { height:1, background:BORDER, margin:"14px 0" },
  tagCloud:   { display:"flex", flexWrap:"wrap", gap:6 },
  repoBox:    { display:"flex", flexDirection:"column", gap:6 },
  repoStat:   { fontSize:12, color:"#888", display:"flex", alignItems:"center", gap:6, fontFamily:"system-ui,sans-serif", wordBreak:"break-all" },
  pageHead:   { marginBottom:28, paddingBottom:18, borderBottom:`1px solid ${BORDER}` },
  pageTitle:  { fontFamily:"'Playfair Display',Georgia,serif", fontSize:34, fontWeight:700, color:"#1a1a1a", marginBottom:4 },
  catH:       { fontFamily:"'Playfair Display',Georgia,serif", fontSize:22, fontWeight:600, color:"#1a1a1a", marginBottom:14, paddingBottom:8, borderBottom:`2px solid ${G}`, display:"inline-flex", alignItems:"center", gap:8 },
  catLabel:   { fontSize:11, fontWeight:700, color:G, textTransform:"uppercase", letterSpacing:".08em", fontFamily:"system-ui,sans-serif" },
  dateLabel:  { fontSize:12, color:"#999", fontFamily:"system-ui,sans-serif" },
  cardTitle:  { fontFamily:"'Playfair Display',Georgia,serif", fontSize:22, fontWeight:700, color:"#1a1a1a", marginBottom:8, lineHeight:1.3 },
  cardDesc:   { fontSize:14, color:"#555", lineHeight:1.65, marginBottom:12 },
  tagChip:    { background:"#e8f5eb", color:G, borderRadius:4, padding:"2px 8px", fontSize:12, fontWeight:500, fontFamily:"system-ui,sans-serif" },
  detail:     { maxWidth:700 },
  detailTitle:{ fontFamily:"'Playfair Display',Georgia,serif", fontSize:40, fontWeight:700, lineHeight:1.2, marginBottom:16, color:"#1a1a1a" },
  detailDesc: { fontSize:16, color:"#555", lineHeight:1.8, marginBottom:28, fontStyle:"italic", borderLeft:`3px solid ${G}`, paddingLeft:16 },
  section:    { marginBottom:28 },
  sectionH:   { fontFamily:"'Playfair Display',Georgia,serif", fontSize:20, fontWeight:600, color:"#1a1a1a", marginBottom:12, paddingBottom:8, borderBottom:`1px solid ${BORDER}` },
  notesBox:   { background:"#f0f7f1", border:`1px solid #c5dfc9`, borderRadius:8, padding:"14px 18px", fontSize:14, color:"#444", lineHeight:1.6 },
  overlay:    { position:"fixed", inset:0, background:"rgba(0,0,0,.6)", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center", padding:20 },
  modal:      { background:"white", borderRadius:12, width:"100%", maxWidth:660, maxHeight:"90vh", display:"flex", flexDirection:"column", boxShadow:"0 20px 60px rgba(0,0,0,.35)" },
  mHead:      { display:"flex", justifyContent:"space-between", alignItems:"center", padding:"18px 24px", borderBottom:`1px solid ${BORDER}` },
  mTitle:     { fontFamily:"'Playfair Display',Georgia,serif", fontSize:22, fontWeight:700 },
  xBtn:       { background:"none", border:"none", fontSize:20, cursor:"pointer", color:"#999", padding:4, lineHeight:1 },
  mBody:      { padding:"20px 24px", overflowY:"auto", display:"flex", flexDirection:"column", gap:16 },
  mFoot:      { display:"flex", justifyContent:"flex-end", gap:10, padding:"14px 24px", borderTop:`1px solid ${BORDER}` },
  label:      { fontSize:13, fontWeight:600, color:"#333", fontFamily:"system-ui,sans-serif" },
  cancelBtn:  { background:"white", border:`1px solid ${BORDER}`, borderRadius:6, padding:"8px 18px", fontSize:14, cursor:"pointer", fontFamily:"system-ui,sans-serif" },
  saveBtn:    { background:G, color:"white", border:"none", borderRadius:6, padding:"8px 20px", fontSize:14, fontWeight:600, cursor:"pointer", fontFamily:"system-ui,sans-serif" },
  empty:      { textAlign:"center", padding:"80px 40px" },
  emptyH:     { fontFamily:"'Playfair Display',Georgia,serif", fontSize:24, marginBottom:8 },
  toast:      { position:"fixed", bottom:24, right:24, background:G, color:"white", borderRadius:8, padding:"12px 20px", fontSize:14, fontWeight:500, zIndex:2000, boxShadow:"0 4px 12px rgba(0,0,0,.2)", fontFamily:"system-ui,sans-serif" },
};

// ─── Injected CSS ──────────────────────────────────────────────────────────────
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,600;0,700;1,400&family=Source+Serif+4:ital,opsz,wght@0,8..60,400;1,8..60,400&display=swap');
*{box-sizing:border-box;margin:0;padding:0;}
::placeholder{color:#bbb;}

.gf-search{background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.2);border-radius:6px;padding:8px 12px 8px 32px;color:white;font-size:14px;width:200px;outline:none;font-family:system-ui,sans-serif;}
.gf-search:focus{border-color:rgba(255,255,255,.5);}
.gf-search::placeholder{color:rgba(255,255,255,.4);}

.gf-add{background:#4a9e5c;color:white;border:none;border-radius:6px;padding:9px 18px;font-size:14px;font-weight:600;cursor:pointer;font-family:system-ui,sans-serif;white-space:nowrap;transition:background .15s;}
.gf-add:hover{background:#3a8a4a;}

.gf-settings{background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.15);border-radius:6px;padding:8px 10px;cursor:pointer;font-size:16px;transition:background .15s;}
.gf-settings:hover{background:rgba(255,255,255,.18);}

.gf-nav{display:flex;align-items:center;padding:8px 12px;border-radius:6px;background:none;border:none;cursor:pointer;font-size:14px;color:#444;font-family:system-ui,sans-serif;text-align:left;width:100%;transition:background .15s;}
.gf-nav:hover{background:#f0ede6;}
.gf-nav-on{background:#e8f5eb!important;color:#2a5934!important;font-weight:600;}

.gf-tag{background:#f0ede6;border:1px solid #e0dbd3;border-radius:20px;padding:3px 10px;font-size:12px;cursor:pointer;color:#555;font-family:system-ui,sans-serif;transition:all .15s;}
.gf-tag:hover{background:#e8f5eb;border-color:#c5dfc9;color:#2a5934;}
.gf-tag-on{background:#2a5934!important;color:white!important;border-color:#2a5934!important;}

.gf-card{background:white;border:1px solid #e8e4dc;border-radius:10px;padding:20px 24px;margin-bottom:14px;cursor:pointer;transition:all .2s;box-shadow:0 1px 3px rgba(0,0,0,.05);}
.gf-card:hover{border-color:#2a5934;box-shadow:0 4px 14px rgba(42,89,52,.13);transform:translateY(-1px);}

.gf-back{background:none;border:none;color:#2a5934;font-size:14px;cursor:pointer;font-weight:600;font-family:system-ui,sans-serif;padding:6px 0;}
.gf-back:hover{text-decoration:underline;}

.gf-edit-btn{background:white;border:1px solid #e8e4dc;border-radius:6px;padding:6px 14px;font-size:13px;cursor:pointer;font-family:system-ui,sans-serif;color:#444;transition:background .15s;}
.gf-edit-btn:hover{background:#f0ede6;}
.gf-edit-btn:disabled{opacity:.5;cursor:not-allowed;}

.gf-del-btn{background:white;border:1px solid #f5c6c6;border-radius:6px;padding:6px 14px;font-size:13px;cursor:pointer;font-family:system-ui,sans-serif;color:#c0392b;transition:background .15s;}
.gf-del-btn:hover{background:#fdf0f0;}
.gf-del-btn:disabled{opacity:.5;cursor:not-allowed;}

.gf-inp{border:1px solid #e8e4dc;border-radius:6px;padding:9px 12px;font-size:14px;font-family:system-ui,sans-serif;color:#1a1a1a;outline:none;width:100%;background:white;}
.gf-inp:focus{border-color:#2a5934;box-shadow:0 0 0 2px rgba(42,89,52,.15);}
.gf-ta{resize:vertical;line-height:1.6;}
`;
