mod common;

use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt;
use serde_json::{json, Value};
use tower::ServiceExt;

#[tokio::test]
async fn test_search_across_entities() {
    let (app, _temp_db) = common::setup_test_app().await;

    // Create searchable data
    let task_body = json!({"title": "Important Rust task", "description": "Learn Rust programming", "status": "todo"});
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

    let note_body = json!({"title": "Rust Notes", "content": "Important concepts about Rust"});
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

    let goal_body = json!({"title": "Rust Goal", "description": "Building a CLI tool"});
    app.clone()
        .oneshot(
            Request::builder()
                .uri("/api/goals")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_vec(&goal_body).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();

    // Search for "Rust"
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/search?q=Rust")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body_bytes = response.into_body().collect().await.unwrap().to_bytes();
    let payload: Value = serde_json::from_slice(&body_bytes).unwrap();

    assert_eq!(payload["query"], "Rust");
    let results = payload["results"].as_array().unwrap();
    assert!(results
        .iter()
        .any(|r| r["type"] == "Task" && r["title"].as_str().unwrap().contains("Rust")));
    assert!(results
        .iter()
        .any(|r| r["type"] == "Note" && r["title"].as_str().unwrap().contains("Rust")));
    assert!(results
        .iter()
        .any(|r| r["type"] == "Goal" && r["title"].as_str().unwrap().contains("Rust")));
}

#[tokio::test]
async fn test_search_empty_query() {
    let (app, _temp_db) = common::setup_test_app().await;

    // Search with empty query returns empty results list
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/search?q=")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body_bytes = response.into_body().collect().await.unwrap().to_bytes();
    let payload: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(payload["results"].as_array().unwrap().len(), 0);
}

#[tokio::test]
async fn test_search_no_results() {
    let (app, _temp_db) = common::setup_test_app().await;

    // Create some data
    let task_body = json!({"title": "Task about JavaScript", "status": "todo"});
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

    // Search for something that doesn't exist
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/search?q=Python")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body_bytes = response.into_body().collect().await.unwrap().to_bytes();
    let payload: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(payload["results"].as_array().unwrap().len(), 0);
}

#[tokio::test]
async fn test_search_case_insensitive() {
    let (app, _temp_db) = common::setup_test_app().await;

    // Create data with mixed case
    let task_body = json!({"title": "IMPORTANT Task", "status": "todo"});
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

    // Search with lowercase
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/search?q=important")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body_bytes = response.into_body().collect().await.unwrap().to_bytes();
    let payload: Value = serde_json::from_slice(&body_bytes).unwrap();

    let results = payload["results"].as_array().unwrap();
    assert!(!results.is_empty());
    assert!(results.iter().any(|r| r["type"] == "Task"));
}

#[tokio::test]
async fn test_search_in_descriptions() {
    let (app, _temp_db) = common::setup_test_app().await;

    // Create task with keyword in description
    let task_body = json!({
        "title": "Weekly Meeting",
        "description": "Discuss project roadmap and milestones",
        "status": "todo"
    });
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

    // Search for keyword that's only in description
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/search?q=roadmap")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body_bytes = response.into_body().collect().await.unwrap().to_bytes();
    let payload: Value = serde_json::from_slice(&body_bytes).unwrap();

    let results = payload["results"].as_array().unwrap();
    assert!(!results.is_empty());
    assert!(results
        .iter()
        .any(|r| r["description"].as_str().unwrap_or("").contains("roadmap")));
}

#[tokio::test]
async fn test_search_partial_match() {
    let (app, _temp_db) = common::setup_test_app().await;

    // Create data
    let note_body = json!({"title": "Programming", "content": "Learning programming languages"});
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

    // Search with partial word
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/search?q=program")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body_bytes = response.into_body().collect().await.unwrap().to_bytes();
    let payload: Value = serde_json::from_slice(&body_bytes).unwrap();

    let results = payload["results"].as_array().unwrap();
    assert!(!results.is_empty());
    assert!(results.iter().any(|r| r["type"] == "Note"));
}

#[tokio::test]
async fn test_search_multiple_entities() {
    let (app, _temp_db) = common::setup_test_app().await;

    let keyword = "budget";

    let task_body = json!({"title": "Review budget report", "status": "todo"});
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

    let note_body = json!({"title": "Budget planning notes", "content": "2026 budget allocation"});
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

    let goal_body = json!({"title": "Reduce budget by 10%", "status": "in-progress"});
    app.clone()
        .oneshot(
            Request::builder()
                .uri("/api/goals")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_vec(&goal_body).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/api/search?q={}", keyword))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body_bytes = response.into_body().collect().await.unwrap().to_bytes();
    let payload: Value = serde_json::from_slice(&body_bytes).unwrap();

    let results = payload["results"].as_array().unwrap();
    assert!(results.iter().any(|r| r["type"] == "Task"));
    assert!(results.iter().any(|r| r["type"] == "Note"));
    assert!(results.iter().any(|r| r["type"] == "Goal"));
}

#[tokio::test]
async fn test_search_special_characters() {
    let (app, _temp_db) = common::setup_test_app().await;

    let task_body = json!({"title": "Fix bug #123", "status": "todo"});
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
                .uri("/api/search?q=%23123")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body_bytes = response.into_body().collect().await.unwrap().to_bytes();
    let payload: Value = serde_json::from_slice(&body_bytes).unwrap();

    let results = payload["results"].as_array().unwrap();
    assert!(!results.is_empty());
    assert!(results.iter().any(|r| r["type"] == "Task"));
}
