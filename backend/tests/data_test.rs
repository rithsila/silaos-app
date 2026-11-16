mod common;

use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt;
use serde_json::{json, Value};
use tower::ServiceExt;

#[tokio::test]
async fn test_get_stats_endpoint() {
    let (app, _temp_db) = common::setup_test_app().await;

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/data/stats")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body_bytes = response.into_body().collect().await.unwrap().to_bytes();
    let stats: Value = serde_json::from_slice(&body_bytes).unwrap();

    let counts = &stats["counts"];
    assert_eq!(counts["tasks"], 0);
    assert_eq!(counts["projects"], 0);
    assert_eq!(counts["habits"], 0);
    assert_eq!(counts["notes"], 0);
    assert_eq!(counts["goals"], 0);
}

#[tokio::test]
async fn test_stats_with_data() {
    let (app, _temp_db) = common::setup_test_app().await;

    for i in 1..=3 {
        let body = json!({"title": format!("Task {}", i), "status": "todo"});
        app.clone()
            .oneshot(
                Request::builder()
                    .uri("/api/tasks")
                    .method("POST")
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::to_vec(&body).unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap();
    }

    for i in 1..=2 {
        let body = json!({"title": format!("Note {}", i), "content": "Test content"});
        app.clone()
            .oneshot(
                Request::builder()
                    .uri("/api/notes")
                    .method("POST")
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::to_vec(&body).unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap();
    }

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/data/stats")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body_bytes = response.into_body().collect().await.unwrap().to_bytes();
    let stats: Value = serde_json::from_slice(&body_bytes).unwrap();

    assert_eq!(stats["counts"]["tasks"], 3);
    assert_eq!(stats["counts"]["notes"], 2);
}

#[tokio::test]
async fn test_export_data_endpoint() {
    let (app, _temp_db) = common::setup_test_app().await;

    let task_body = json!({"title": "Export Test Task", "status": "todo"});
    app.clone()
        .oneshot(
            Request::builder()
                .uri("/api/tasks")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_vec(&task_body).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/data/export")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body_bytes = response.into_body().collect().await.unwrap().to_bytes();
    let export_payload: Value = serde_json::from_slice(&body_bytes).unwrap();

    assert!(export_payload.get("version").is_some());
    assert!(export_payload.get("exportedAt").is_some());
    let data = &export_payload["data"];
    assert!(data.get("tasks").is_some());
    assert!(data.get("projects").is_some());
    assert!(data.get("habits").is_some());
    assert!(data.get("notes").is_some());
    assert!(data.get("goals").is_some());

    let tasks = data["tasks"].as_array().unwrap();
    assert_eq!(tasks.len(), 1);
    assert_eq!(tasks[0]["title"], "Export Test Task");
}

#[tokio::test]
async fn test_import_data_endpoint() {
    let (app, _temp_db) = common::setup_test_app().await;

    let import_body = json!({
        "version": "1.0.0",
        "data": {
            "tasks": [
                {
                    "id": "import_task_1",
                    "title": "Imported Task",
                    "status": "todo",
                    "priority": "high"
                }
            ],
            "projects": [
                {
                    "id": "import_project_1",
                    "name": "Imported Project",
                    "status": "active"
                }
            ],
            "habits": [],
            "goals": []
        }
    });

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/data/import")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_vec(&import_body).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/tasks")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let body_bytes = response.into_body().collect().await.unwrap().to_bytes();
    let tasks: Vec<Value> = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(tasks.len(), 1);
    assert_eq!(tasks[0]["title"], "Imported Task");

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/projects")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let body_bytes = response.into_body().collect().await.unwrap().to_bytes();
    let projects: Vec<Value> = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(projects.len(), 1);
    assert_eq!(projects[0]["name"], "Imported Project");
}

#[tokio::test]
async fn test_backup_and_restore() {
    let (app, _temp_db) = common::setup_test_app().await;

    let task_body = json!({"title": "Backup Test", "status": "todo"});
    app.clone()
        .oneshot(
            Request::builder()
                .uri("/api/tasks")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_vec(&task_body).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/data/export")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let body_bytes = response.into_body().collect().await.unwrap().to_bytes();
    let backup_data: Value = serde_json::from_slice(&body_bytes).unwrap();

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/tasks")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let body_bytes = response.into_body().collect().await.unwrap().to_bytes();
    let tasks: Vec<Value> = serde_json::from_slice(&body_bytes).unwrap();
    let task_id = tasks[0]["id"].as_str().unwrap();

    app.clone()
        .oneshot(
            Request::builder()
                .uri(format!("/api/tasks/{}", task_id))
                .method("DELETE")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/tasks")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let body_bytes = response.into_body().collect().await.unwrap().to_bytes();
    let tasks: Vec<Value> = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(tasks.len(), 0);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/data/import")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_vec(&backup_data).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/tasks")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let body_bytes = response.into_body().collect().await.unwrap().to_bytes();
    let tasks: Vec<Value> = serde_json::from_slice(&body_bytes).unwrap();
    assert!(!tasks.is_empty());
}

#[tokio::test]
async fn test_clear_all_data() {
    let (app, _temp_db) = common::setup_test_app().await;

    let task_body = json!({"title": "Test Task", "status": "todo"});
    app.clone()
        .oneshot(
            Request::builder()
                .uri("/api/tasks")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_vec(&task_body).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();

    let note_body = json!({"title": "Test Note", "content": "Content"});
    app.clone()
        .oneshot(
            Request::builder()
                .uri("/api/notes")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_vec(&note_body).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/data/stats")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let body_bytes = response.into_body().collect().await.unwrap().to_bytes();
    let stats: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert!(stats["counts"]["tasks"].as_i64().unwrap() > 0);
    assert!(stats["counts"]["notes"].as_i64().unwrap() > 0);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/data/reset")
                .method("DELETE")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({"confirm": "RESET_ALL_DATA"})).unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/data/stats")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let body_bytes = response.into_body().collect().await.unwrap().to_bytes();
    let stats: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(stats["counts"]["tasks"], 0);
    assert_eq!(stats["counts"]["notes"], 0);
}
