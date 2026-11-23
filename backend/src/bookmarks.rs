use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    routing::get,
    Json, Router,
};
use serde::Serialize;
use serde_json::Value;
use sqlx::{sqlite::SqliteRow, QueryBuilder, Row, Sqlite, SqlitePool};
use std::collections::HashMap;

use crate::error::AppError;
use crate::prisma_dt::PrismaDateTime;
use crate::utils::*;
use crate::AppState;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Bookmark {
    pub id: String,
    pub url: String,
    pub title: String,
    pub description: Option<String>,
    pub favicon: Option<String>,
    pub user_note: Option<String>,
    pub importance: String,
    pub status: String,
    pub folder_id: Option<String>,
    pub project_id: Option<String>,
    pub note_id: Option<String>,
    pub suggested_folder_id: Option<String>,
    pub suggested_importance: Option<String>,
    pub suggestion_reason: Option<String>,
    pub created_at: PrismaDateTime,
    pub updated_at: PrismaDateTime,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BookmarkFolderCount {
    pub bookmarks: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BookmarkFolder {
    pub id: String,
    pub name: String,
    pub icon: Option<String>,
    pub color: Option<String>,
    pub order: i64,
    pub created_at: PrismaDateTime,
    pub updated_at: PrismaDateTime,
    #[serde(rename = "_count", skip_serializing_if = "Option::is_none")]
    pub count: Option<BookmarkFolderCount>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BookmarkFolderMini {
    pub id: String,
    pub name: String,
    pub icon: Option<String>,
    pub color: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TagMini {
    pub id: String,
    pub name: String,
    pub color: String,
    pub created_at: PrismaDateTime,
    pub updated_at: PrismaDateTime,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BookmarkTagFull {
    pub id: String,
    pub bookmark_id: String,
    pub tag_id: String,
    pub tag: TagMini,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMini {
    pub id: String,
    pub name: String,
    pub color: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteMini {
    pub id: String,
    pub title: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BookmarkFull {
    #[serde(flatten)]
    pub bookmark: Bookmark,
    pub folder: Option<BookmarkFolderMini>,
    pub tags: Vec<BookmarkTagFull>,
    pub project: Option<ProjectMini>,
    pub note: Option<NoteMini>,
}

fn bookmark_from_row(r: &SqliteRow) -> Result<Bookmark, sqlx::Error> {
    Ok(Bookmark {
        id: r.try_get("id")?,
        url: r.try_get("url")?,
        title: r.try_get("title")?,
        description: r.try_get("description")?,
        favicon: r.try_get("favicon")?,
        user_note: r.try_get("userNote")?,
        importance: r.try_get("importance")?,
        status: r.try_get("status")?,
        folder_id: r.try_get("folderId")?,
        project_id: r.try_get("projectId")?,
        note_id: r.try_get("noteId")?,
        suggested_folder_id: r.try_get("suggestedFolderId")?,
        suggested_importance: r.try_get("suggestedImportance")?,
        suggestion_reason: r.try_get("suggestionReason")?,
        created_at: PrismaDateTime(r.try_get::<i64, _>("createdAt")?),
        updated_at: PrismaDateTime(r.try_get::<i64, _>("updatedAt")?),
    })
}

fn folder_from_row(
    r: &SqliteRow,
    count: Option<BookmarkFolderCount>,
) -> Result<BookmarkFolder, sqlx::Error> {
    Ok(BookmarkFolder {
        id: r.try_get("id")?,
        name: r.try_get("name")?,
        icon: r.try_get("icon")?,
        color: r.try_get("color")?,
        order: r.try_get("order")?,
        created_at: PrismaDateTime(r.try_get::<i64, _>("createdAt")?),
        updated_at: PrismaDateTime(r.try_get::<i64, _>("updatedAt")?),
        count,
    })
}

async fn fetch_bookmark_tags(
    db: &SqlitePool,
    bookmark_id: &str,
) -> Result<Vec<BookmarkTagFull>, sqlx::Error> {
    let rows = sqlx::query(
        "SELECT bt.id AS bt_id, bt.bookmarkId AS bt_bookmarkId, bt.tagId AS bt_tagId, \
         t.id AS t_id, t.name AS t_name, t.color AS t_color, \
         t.createdAt AS t_createdAt, t.updatedAt AS t_updatedAt \
         FROM BookmarkTag bt JOIN Tag t ON t.id = bt.tagId WHERE bt.bookmarkId = ?",
    )
    .bind(bookmark_id)
    .fetch_all(db)
    .await?;

    rows.iter()
        .map(|r| {
            Ok(BookmarkTagFull {
                id: r.try_get("bt_id")?,
                bookmark_id: r.try_get("bt_bookmarkId")?,
                tag_id: r.try_get("bt_tagId")?,
                tag: TagMini {
                    id: r.try_get("t_id")?,
                    name: r.try_get("t_name")?,
                    color: r.try_get("t_color")?,
                    created_at: PrismaDateTime(r.try_get::<i64, _>("t_createdAt")?),
                    updated_at: PrismaDateTime(r.try_get::<i64, _>("t_updatedAt")?),
                },
            })
        })
        .collect()
}

async fn enrich_bookmark(db: &SqlitePool, bookmark: Bookmark) -> Result<BookmarkFull, sqlx::Error> {
    let folder = match &bookmark.folder_id {
        Some(fid) => {
            let row = sqlx::query("SELECT id, name, icon, color FROM BookmarkFolder WHERE id = ?")
                .bind(fid)
                .fetch_optional(db)
                .await?;
            row.map(|r| BookmarkFolderMini {
                id: r.get("id"),
                name: r.get("name"),
                icon: r.get("icon"),
                color: r.get("color"),
            })
        }
        None => None,
    };

    let tags = fetch_bookmark_tags(db, &bookmark.id).await?;

    let project = match &bookmark.project_id {
        Some(pid) => {
            let row = sqlx::query("SELECT id, name, color FROM Project WHERE id = ?")
                .bind(pid)
                .fetch_optional(db)
                .await?;
            row.map(|r| ProjectMini {
                id: r.get("id"),
                name: r.get("name"),
                color: r.get("color"),
            })
        }
        None => None,
    };

    let note = match &bookmark.note_id {
        Some(nid) => {
            let row = sqlx::query("SELECT id, title FROM Note WHERE id = ?")
                .bind(nid)
                .fetch_optional(db)
                .await?;
            row.map(|r| NoteMini {
                id: r.get("id"),
                title: r.get("title"),
            })
        }
        None => None,
    };

    Ok(BookmarkFull {
        bookmark,
        folder,
        tags,
        project,
        note,
    })
}

async fn sync_bookmark_tags(
    db: &SqlitePool,
    bookmark_id: &str,
    body: &Value,
) -> Result<(), AppError> {
    let tags_val = body.get("tagIds").or_else(|| body.get("tags"));
    if let Some(arr) = tags_val.and_then(|v| v.as_array()) {
        sqlx::query("DELETE FROM BookmarkTag WHERE bookmarkId = ?")
            .bind(bookmark_id)
            .execute(db)
            .await?;

        for item in arr {
            let tag_id = match item {
                Value::String(s) => s.as_str(),
                Value::Object(map) => map.get("id").and_then(|v| v.as_str()).unwrap_or(""),
                _ => "",
            };
            if !tag_id.is_empty() {
                let bt_id = gen_id();
                sqlx::query(
                    "INSERT OR IGNORE INTO BookmarkTag (id, bookmarkId, tagId) VALUES (?, ?, ?)",
                )
                .bind(bt_id)
                .bind(bookmark_id)
                .bind(tag_id)
                .execute(db)
                .await?;
            }
        }
    }
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// Folder Handlers
// ─────────────────────────────────────────────────────────────────────────────

pub async fn list_folders(
    State(st): State<AppState>,
) -> Result<Json<Vec<BookmarkFolder>>, AppError> {
    let rows = sqlx::query("SELECT * FROM BookmarkFolder ORDER BY \"order\" ASC, createdAt ASC")
        .fetch_all(&st.db)
        .await?;

    let mut out = Vec::with_capacity(rows.len());
    for r in &rows {
        let id: String = r.try_get("id")?;
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM Bookmark WHERE folderId = ?")
            .bind(&id)
            .fetch_one(&st.db)
            .await?;
        out.push(folder_from_row(
            r,
            Some(BookmarkFolderCount { bookmarks: count }),
        )?);
    }
    Ok(Json(out))
}

pub async fn create_folder(
    State(st): State<AppState>,
    Json(body): Json<Value>,
) -> Result<(StatusCode, Json<BookmarkFolder>), AppError> {
    let name = body
        .get("name")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| AppError::BadRequest("Name is required".to_string()))?
        .to_string();

    let id = gen_id();
    let now = now_ms();
    let icon = str_or(&body, "icon", "folder");
    let color = str_or(&body, "color", "#3b82f6");
    let order = body.get("order").and_then(|v| v.as_i64()).unwrap_or(0);

    sqlx::query(
        "INSERT INTO BookmarkFolder (id, name, icon, color, \"order\", createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&name)
    .bind(&icon)
    .bind(&color)
    .bind(order)
    .bind(now)
    .bind(now)
    .execute(&st.db)
    .await?;

    let r = sqlx::query("SELECT * FROM BookmarkFolder WHERE id = ?")
        .bind(&id)
        .fetch_one(&st.db)
        .await?;

    Ok((
        StatusCode::CREATED,
        Json(folder_from_row(
            &r,
            Some(BookmarkFolderCount { bookmarks: 0 }),
        )?),
    ))
}

pub async fn get_folder(
    State(st): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<BookmarkFolder>, AppError> {
    let row = sqlx::query("SELECT * FROM BookmarkFolder WHERE id = ?")
        .bind(&id)
        .fetch_optional(&st.db)
        .await?;

    match row {
        Some(r) => {
            let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM Bookmark WHERE folderId = ?")
                .bind(&id)
                .fetch_one(&st.db)
                .await?;
            Ok(Json(folder_from_row(
                &r,
                Some(BookmarkFolderCount { bookmarks: count }),
            )?))
        }
        None => Err(AppError::NotFound("Bookmark folder not found".to_string())),
    }
}

pub async fn update_folder(
    State(st): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> Result<Json<BookmarkFolder>, AppError> {
    let exists: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM BookmarkFolder WHERE id = ?")
        .bind(&id)
        .fetch_one(&st.db)
        .await?;
    if exists == 0 {
        return Err(AppError::NotFound("Bookmark folder not found".to_string()));
    }

    let now = now_ms();
    let mut qb: QueryBuilder<Sqlite> = QueryBuilder::new("UPDATE BookmarkFolder SET ");
    let mut first = true;

    if let Some(v) = body.get("name").and_then(|v| v.as_str()) {
        let trimmed = v.trim();
        if trimmed.is_empty() {
            return Err(AppError::BadRequest("Name cannot be empty".to_string()));
        }
        crate::push_set!(qb, first, "name = ", trimmed.to_string());
    }
    if let Some(v) = patch_str(&body, "icon") {
        crate::push_set!(qb, first, "icon = ", v);
    }
    if let Some(v) = patch_str(&body, "color") {
        crate::push_set!(qb, first, "color = ", v);
    }
    if let Some(v) = patch_i64(&body, "order") {
        crate::push_set!(qb, first, "\"order\" = ", v.unwrap_or(0));
    }
    crate::push_set!(qb, first, "updatedAt = ", now);
    qb.push(" WHERE id = ").push_bind(&id);
    qb.build().execute(&st.db).await?;

    let r = sqlx::query("SELECT * FROM BookmarkFolder WHERE id = ?")
        .bind(&id)
        .fetch_one(&st.db)
        .await?;
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM Bookmark WHERE folderId = ?")
        .bind(&id)
        .fetch_one(&st.db)
        .await?;
    Ok(Json(folder_from_row(
        &r,
        Some(BookmarkFolderCount { bookmarks: count }),
    )?))
}

pub async fn delete_folder(
    State(st): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Value>, AppError> {
    let exists: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM BookmarkFolder WHERE id = ?")
        .bind(&id)
        .fetch_one(&st.db)
        .await?;
    if exists == 0 {
        return Err(AppError::NotFound("Bookmark folder not found".to_string()));
    }
    sqlx::query("DELETE FROM BookmarkFolder WHERE id = ?")
        .bind(&id)
        .execute(&st.db)
        .await?;
    Ok(Json(serde_json::json!({ "success": true })))
}

// ─────────────────────────────────────────────────────────────────────────────
// Bookmark Handlers
// ─────────────────────────────────────────────────────────────────────────────

pub async fn list_bookmarks(
    State(st): State<AppState>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Json<Vec<BookmarkFull>>, AppError> {
    let mut qb: QueryBuilder<Sqlite> = QueryBuilder::new("SELECT * FROM Bookmark WHERE 1=1");

    if let Some(fid) = params.get("folderId") {
        if fid == "none" || fid == "null" || fid.is_empty() {
            qb.push(" AND folderId IS NULL");
        } else {
            qb.push(" AND folderId = ").push_bind(fid.clone());
        }
    }
    if let Some(status) = params.get("status") {
        if !status.is_empty() {
            qb.push(" AND status = ").push_bind(status.clone());
        }
    }
    if let Some(importance) = params.get("importance") {
        if !importance.is_empty() {
            qb.push(" AND importance = ").push_bind(importance.clone());
        }
    }
    if let Some(q) = params.get("search") {
        let trimmed = q.trim();
        if !trimmed.is_empty() {
            let pat = format!("%{}%", trimmed);
            qb.push(" AND (title LIKE ")
                .push_bind(pat.clone())
                .push(" OR url LIKE ")
                .push_bind(pat.clone())
                .push(" OR description LIKE ")
                .push_bind(pat.clone())
                .push(" OR userNote LIKE ")
                .push_bind(pat)
                .push(")");
        }
    }

    qb.push(" ORDER BY createdAt DESC");

    let rows = qb.build().fetch_all(&st.db).await?;
    let mut out = Vec::with_capacity(rows.len());
    for r in &rows {
        let bm = bookmark_from_row(r)?;
        out.push(enrich_bookmark(&st.db, bm).await?);
    }
    Ok(Json(out))
}

pub async fn create_bookmark(
    State(st): State<AppState>,
    Json(body): Json<Value>,
) -> Result<(StatusCode, Json<BookmarkFull>), AppError> {
    let url = body
        .get("url")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| AppError::BadRequest("URL is required".to_string()))?
        .to_string();

    let title = body
        .get("title")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(&url)
        .to_string();

    let id = gen_id();
    let now = now_ms();

    let description = truthy_str(&body, "description");
    let favicon = truthy_str(&body, "favicon");
    let user_note = truthy_str(&body, "userNote");
    let importance = str_or(&body, "importance", "normal");
    let status = str_or(&body, "status", "inbox");
    let folder_id = truthy_str(&body, "folderId");
    let project_id = truthy_str(&body, "projectId");
    let note_id = truthy_str(&body, "noteId");
    let suggested_folder_id = truthy_str(&body, "suggestedFolderId");
    let suggested_importance = truthy_str(&body, "suggestedImportance");
    let suggestion_reason = truthy_str(&body, "suggestionReason");

    sqlx::query(
        "INSERT INTO Bookmark (
            id, url, title, description, favicon, userNote, importance, status,
            folderId, projectId, noteId, suggestedFolderId, suggestedImportance,
            suggestionReason, createdAt, updatedAt
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&url)
    .bind(&title)
    .bind(&description)
    .bind(&favicon)
    .bind(&user_note)
    .bind(&importance)
    .bind(&status)
    .bind(&folder_id)
    .bind(&project_id)
    .bind(&note_id)
    .bind(&suggested_folder_id)
    .bind(&suggested_importance)
    .bind(&suggestion_reason)
    .bind(now)
    .bind(now)
    .execute(&st.db)
    .await?;

    sync_bookmark_tags(&st.db, &id, &body).await?;

    let r = sqlx::query("SELECT * FROM Bookmark WHERE id = ?")
        .bind(&id)
        .fetch_one(&st.db)
        .await?;
    let bm = bookmark_from_row(&r)?;
    let full = enrich_bookmark(&st.db, bm).await?;

    Ok((StatusCode::CREATED, Json(full)))
}

pub async fn get_bookmark(
    State(st): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<BookmarkFull>, AppError> {
    let row = sqlx::query("SELECT * FROM Bookmark WHERE id = ?")
        .bind(&id)
        .fetch_optional(&st.db)
        .await?;

    match row {
        Some(r) => {
            let bm = bookmark_from_row(&r)?;
            let full = enrich_bookmark(&st.db, bm).await?;
            Ok(Json(full))
        }
        None => Err(AppError::NotFound("Bookmark not found".to_string())),
    }
}

pub async fn update_bookmark(
    State(st): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> Result<Json<BookmarkFull>, AppError> {
    let exists: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM Bookmark WHERE id = ?")
        .bind(&id)
        .fetch_one(&st.db)
        .await?;
    if exists == 0 {
        return Err(AppError::NotFound("Bookmark not found".to_string()));
    }

    let now = now_ms();
    let mut qb: QueryBuilder<Sqlite> = QueryBuilder::new("UPDATE Bookmark SET ");
    let mut first = true;

    if let Some(v) = body.get("url").and_then(|v| v.as_str()) {
        let trimmed = v.trim();
        if trimmed.is_empty() {
            return Err(AppError::BadRequest("URL cannot be empty".to_string()));
        }
        crate::push_set!(qb, first, "url = ", trimmed.to_string());
    }
    if let Some(v) = body.get("title").and_then(|v| v.as_str()) {
        crate::push_set!(qb, first, "title = ", v.trim().to_string());
    }
    if let Some(v) = patch_str(&body, "description") {
        crate::push_set!(qb, first, "description = ", v);
    }
    if let Some(v) = patch_str(&body, "favicon") {
        crate::push_set!(qb, first, "favicon = ", v);
    }
    if let Some(v) = patch_str(&body, "userNote") {
        crate::push_set!(qb, first, "userNote = ", v);
    }
    if let Some(v) = body.get("importance").and_then(|v| v.as_str()) {
        crate::push_set!(qb, first, "importance = ", v.to_string());
    }
    if let Some(v) = body.get("status").and_then(|v| v.as_str()) {
        crate::push_set!(qb, first, "status = ", v.to_string());
    }
    if let Some(v) = patch_str(&body, "folderId") {
        crate::push_set!(qb, first, "folderId = ", v);
    }
    if let Some(v) = patch_str(&body, "projectId") {
        crate::push_set!(qb, first, "projectId = ", v);
    }
    if let Some(v) = patch_str(&body, "noteId") {
        crate::push_set!(qb, first, "noteId = ", v);
    }
    if let Some(v) = patch_str(&body, "suggestedFolderId") {
        crate::push_set!(qb, first, "suggestedFolderId = ", v);
    }
    if let Some(v) = patch_str(&body, "suggestedImportance") {
        crate::push_set!(qb, first, "suggestedImportance = ", v);
    }
    if let Some(v) = patch_str(&body, "suggestionReason") {
        crate::push_set!(qb, first, "suggestionReason = ", v);
    }

    crate::push_set!(qb, first, "updatedAt = ", now);
    qb.push(" WHERE id = ").push_bind(&id);
    qb.build().execute(&st.db).await?;

    if body.get("tags").is_some() || body.get("tagIds").is_some() {
        sync_bookmark_tags(&st.db, &id, &body).await?;
    }

    let r = sqlx::query("SELECT * FROM Bookmark WHERE id = ?")
        .bind(&id)
        .fetch_one(&st.db)
        .await?;
    let bm = bookmark_from_row(&r)?;
    let full = enrich_bookmark(&st.db, bm).await?;
    Ok(Json(full))
}

pub async fn delete_bookmark(
    State(st): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Value>, AppError> {
    let exists: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM Bookmark WHERE id = ?")
        .bind(&id)
        .fetch_one(&st.db)
        .await?;
    if exists == 0 {
        return Err(AppError::NotFound("Bookmark not found".to_string()));
    }

    sqlx::query("DELETE FROM Bookmark WHERE id = ?")
        .bind(&id)
        .execute(&st.db)
        .await?;

    Ok(Json(serde_json::json!({ "success": true })))
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list_bookmarks).post(create_bookmark))
        .route("/folders", get(list_folders).post(create_folder))
        .route(
            "/folders/{id}",
            get(get_folder)
                .patch(update_folder)
                .put(update_folder)
                .delete(delete_folder),
        )
        .route(
            "/{id}",
            get(get_bookmark)
                .patch(update_bookmark)
                .put(update_bookmark)
                .delete(delete_bookmark),
        )
}
