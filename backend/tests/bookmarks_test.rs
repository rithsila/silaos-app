mod common;

use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt;
use serde_json::{json, Value};
use tower::ServiceExt;

#[tokio::test]
async fn test_bookmark_folders_crud() {
    let (app, _temp_db) = common::setup_test_app().await;

    // 1. List folders - should be empty initially
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/bookmarks/folders")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body_bytes = response.into_body().collect().await.unwrap().to_bytes();
    let folders: Vec<Value> = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(folders.len(), 0);

    // 2. Create folder validation - empty name returns 400
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/bookmarks/folders")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({ "name": "" })).unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);

    // 3. Create folder
    let create_body = json!({
        "name": "Dev Tools",
        "icon": "wrench",
        "color": "#10b981",
        "order": 1
    });
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/bookmarks/folders")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_vec(&create_body).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    let body_bytes = response.into_body().collect().await.unwrap().to_bytes();
    let folder: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(folder["name"], "Dev Tools");
    assert_eq!(folder["icon"], "wrench");
    assert_eq!(folder["color"], "#10b981");
    let folder_id = folder["id"].as_str().unwrap().to_string();

    // 4. Get folder by ID
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/api/bookmarks/folders/{}", folder_id))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body_bytes = response.into_body().collect().await.unwrap().to_bytes();
    let fetched_folder: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(fetched_folder["id"], folder_id);
    assert_eq!(fetched_folder["name"], "Dev Tools");

    // 5. Update folder
    let update_body = json!({
        "name": "Developer Resources",
        "color": "#3b82f6"
    });
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/api/bookmarks/folders/{}", folder_id))
                .method("PATCH")
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_vec(&update_body).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body_bytes = response.into_body().collect().await.unwrap().to_bytes();
    let updated_folder: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(updated_folder["name"], "Developer Resources");
    assert_eq!(updated_folder["color"], "#3b82f6");

    // 6. Delete folder
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/api/bookmarks/folders/{}", folder_id))
                .method("DELETE")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    // 7. Get deleted folder returns 404
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/api/bookmarks/folders/{}", folder_id))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn test_bookmarks_crud() {
    let (app, _temp_db) = common::setup_test_app().await;

    // 1. List bookmarks initially empty
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/bookmarks")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body_bytes = response.into_body().collect().await.unwrap().to_bytes();
    let bookmarks: Vec<Value> = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(bookmarks.len(), 0);

    // 2. Validation: missing URL returns 400
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/bookmarks")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({ "title": "No URL" })).unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);

    // 3. Create bookmark
    let create_body = json!({
        "url": "https://rust-lang.org",
        "title": "Rust Lang",
        "description": "Fast and memory-efficient",
        "importance": "high",
        "status": "inbox"
    });
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/bookmarks")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_vec(&create_body).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    let body_bytes = response.into_body().collect().await.unwrap().to_bytes();
    let created: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(created["url"], "https://rust-lang.org");
    assert_eq!(created["title"], "Rust Lang");
    assert_eq!(created["importance"], "high");
    assert_eq!(created["status"], "inbox");
    let bookmark_id = created["id"].as_str().unwrap().to_string();

    // 4. Get bookmark by ID
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/api/bookmarks/{}", bookmark_id))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body_bytes = response.into_body().collect().await.unwrap().to_bytes();
    let fetched: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(fetched["id"], bookmark_id);
    assert_eq!(fetched["title"], "Rust Lang");

    // 5. Update bookmark
    let update_body = json!({
        "title": "Rust Programming Language",
        "importance": "normal",
        "status": "filed",
        "userNote": "Must learn lifetimes"
    });
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/api/bookmarks/{}", bookmark_id))
                .method("PATCH")
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_vec(&update_body).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body_bytes = response.into_body().collect().await.unwrap().to_bytes();
    let updated: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(updated["title"], "Rust Programming Language");
    assert_eq!(updated["importance"], "normal");
    assert_eq!(updated["status"], "filed");
    assert_eq!(updated["userNote"], "Must learn lifetimes");

    // 6. Delete bookmark
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/api/bookmarks/{}", bookmark_id))
                .method("DELETE")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    // 7. Get deleted bookmark returns 404
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/api/bookmarks/{}", bookmark_id))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn test_bookmarks_filters() {
    let (app, _temp_db) = common::setup_test_app().await;

    // Create folders
    let work_folder_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/bookmarks/folders")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({ "name": "Work" })).unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let body_bytes = work_folder_resp
        .into_body()
        .collect()
        .await
        .unwrap()
        .to_bytes();
    let work_folder: Value = serde_json::from_slice(&body_bytes).unwrap();
    let work_folder_id = work_folder["id"].as_str().unwrap().to_string();

    let reading_folder_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/bookmarks/folders")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({ "name": "Reading" })).unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let body_bytes = reading_folder_resp
        .into_body()
        .collect()
        .await
        .unwrap()
        .to_bytes();
    let reading_folder: Value = serde_json::from_slice(&body_bytes).unwrap();
    let reading_folder_id = reading_folder["id"].as_str().unwrap().to_string();

    // Create bookmark 1: in Work folder, status "inbox", importance "high", title "Rust Programming"
    app.clone()
        .oneshot(
            Request::builder()
                .uri("/api/bookmarks")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "url": "https://doc.rust-lang.org/book/",
                        "title": "Rust Programming Book",
                        "folderId": work_folder_id,
                        "status": "inbox",
                        "importance": "high"
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    // Create bookmark 2: in Work folder, status "filed", importance "normal", title "Axum Framework"
    app.clone()
        .oneshot(
            Request::builder()
                .uri("/api/bookmarks")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "url": "https://github.com/tokio-rs/axum",
                        "title": "Axum Framework",
                        "folderId": work_folder_id,
                        "status": "filed",
                        "importance": "normal"
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    // Create bookmark 3: in Reading folder, status "archived", importance "low", title "TypeScript Deep Dive"
    app.clone()
        .oneshot(
            Request::builder()
                .uri("/api/bookmarks")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "url": "https://basarat.gitbook.io/typescript",
                        "title": "TypeScript Deep Dive",
                        "folderId": reading_folder_id,
                        "status": "archived",
                        "importance": "low"
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    // Create bookmark 4: no folder, status "inbox", importance "low", title "Unorganized Bookmark"
    app.clone()
        .oneshot(
            Request::builder()
                .uri("/api/bookmarks")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "url": "https://example.com/unorganized",
                        "title": "Unorganized Bookmark",
                        "status": "inbox",
                        "importance": "low"
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    // Test filter by folderId
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/api/bookmarks?folderId={}", work_folder_id))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let bytes = resp.into_body().collect().await.unwrap().to_bytes();
    let bms: Vec<Value> = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(bms.len(), 2);

    // Test filter by folderId=none (unorganized)
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/bookmarks?folderId=none")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let bytes = resp.into_body().collect().await.unwrap().to_bytes();
    let bms: Vec<Value> = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(bms.len(), 1);
    assert_eq!(bms[0]["title"], "Unorganized Bookmark");

    // Test filter by status
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/bookmarks?status=inbox")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let bytes = resp.into_body().collect().await.unwrap().to_bytes();
    let bms: Vec<Value> = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(bms.len(), 2);

    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/bookmarks?status=archived")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let bytes = resp.into_body().collect().await.unwrap().to_bytes();
    let bms: Vec<Value> = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(bms.len(), 1);
    assert_eq!(bms[0]["title"], "TypeScript Deep Dive");

    // Test filter by importance
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/bookmarks?importance=high")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let bytes = resp.into_body().collect().await.unwrap().to_bytes();
    let bms: Vec<Value> = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(bms.len(), 1);
    assert_eq!(bms[0]["title"], "Rust Programming Book");

    // Test search filter
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/bookmarks?search=Programming")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let bytes = resp.into_body().collect().await.unwrap().to_bytes();
    let bms: Vec<Value> = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(bms.len(), 1);
    assert_eq!(bms[0]["title"], "Rust Programming Book");
}

#[tokio::test]
async fn test_bookmark_folder_update_and_association() {
    let (app, _temp_db) = common::setup_test_app().await;

    // 1. Create two folders
    let resp_a = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/bookmarks/folders")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({ "name": "Folder A" })).unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let folder_a: Value =
        serde_json::from_slice(&resp_a.into_body().collect().await.unwrap().to_bytes()).unwrap();
    let folder_a_id = folder_a["id"].as_str().unwrap().to_string();

    let resp_b = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/bookmarks/folders")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({ "name": "Folder B" })).unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let folder_b: Value =
        serde_json::from_slice(&resp_b.into_body().collect().await.unwrap().to_bytes()).unwrap();
    let folder_b_id = folder_b["id"].as_str().unwrap().to_string();

    // 2. Create bookmark in Folder A
    let create_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/bookmarks")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "url": "https://example.com/item",
                        "title": "Item 1",
                        "folderId": folder_a_id
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let created_bm: Value =
        serde_json::from_slice(&create_resp.into_body().collect().await.unwrap().to_bytes())
            .unwrap();
    let bookmark_id = created_bm["id"].as_str().unwrap().to_string();

    // Check Folder A count = 1
    let get_a_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/api/bookmarks/folders/{}", folder_a_id))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let folder_a_details: Value =
        serde_json::from_slice(&get_a_resp.into_body().collect().await.unwrap().to_bytes())
            .unwrap();
    assert_eq!(folder_a_details["_count"]["bookmarks"], 1);

    // 3. Update bookmark to move to Folder B
    let update_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/api/bookmarks/{}", bookmark_id))
                .method("PATCH")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "folderId": folder_b_id
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(update_resp.status(), StatusCode::OK);

    // Verify folder counts: A should have 0, B should have 1
    let get_a_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/api/bookmarks/folders/{}", folder_a_id))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let folder_a_details: Value =
        serde_json::from_slice(&get_a_resp.into_body().collect().await.unwrap().to_bytes())
            .unwrap();
    assert_eq!(folder_a_details["_count"]["bookmarks"], 0);

    let get_b_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/api/bookmarks/folders/{}", folder_b_id))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let folder_b_details: Value =
        serde_json::from_slice(&get_b_resp.into_body().collect().await.unwrap().to_bytes())
            .unwrap();
    assert_eq!(folder_b_details["_count"]["bookmarks"], 1);

    // 4. Delete Folder B - verify bookmark still exists with folderId = null (SetNull)
    let del_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/api/bookmarks/folders/{}", folder_b_id))
                .method("DELETE")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(del_resp.status(), StatusCode::OK);

    let get_bm_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/api/bookmarks/{}", bookmark_id))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(get_bm_resp.status(), StatusCode::OK);
    let bm_after_delete: Value =
        serde_json::from_slice(&get_bm_resp.into_body().collect().await.unwrap().to_bytes())
            .unwrap();
    assert!(bm_after_delete["folderId"].is_null());
}
