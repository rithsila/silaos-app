mod common;

use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt;
use serde_json::{json, Value};
use tower::ServiceExt;

#[tokio::test]
async fn test_journal_crud_happy_path() {
    let (app, _temp_db) = common::setup_test_app().await;

    // 1. List journal entries - should be empty initially
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/journal")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body_bytes = response.into_body().collect().await.unwrap().to_bytes();
    let list: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(list["entries"].as_array().unwrap().len(), 0);
    assert_eq!(list["total"], 0);

    // 2. Create a journal entry
    let create_body = json!({
        "date": "2026-06-07",
        "content": "Today was a productive day",
        "mood": "happy",
        "tags": "productive,work"
    });
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/journal")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_vec(&create_body).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    let body_bytes = response.into_body().collect().await.unwrap().to_bytes();
    let created_journal: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(created_journal["content"], "Today was a productive day");
    assert_eq!(created_journal["mood"], "happy");
    let journal_id = created_journal["id"].as_str().unwrap();

    // 3. Get the journal by ID
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/api/journal/{}", journal_id))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body_bytes = response.into_body().collect().await.unwrap().to_bytes();
    let fetched_journal: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(fetched_journal["id"], journal_id);
    assert_eq!(fetched_journal["content"], "Today was a productive day");

    // 4. Update the journal
    let update_body = json!({
        "content": "Updated journal entry",
        "mood": "excited"
    });
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/api/journal/{}", journal_id))
                .method("PATCH")
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_vec(&update_body).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body_bytes = response.into_body().collect().await.unwrap().to_bytes();
    let updated_journal: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(updated_journal["content"], "Updated journal entry");
    assert_eq!(updated_journal["mood"], "excited");

    // 5. List journal entries - should have 1 entry
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/journal")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body_bytes = response.into_body().collect().await.unwrap().to_bytes();
    let list: Value = serde_json::from_slice(&body_bytes).unwrap();
    let journals = list["entries"].as_array().unwrap();
    assert_eq!(journals.len(), 1);
    assert_eq!(journals[0]["content"], "Updated journal entry");

    // 6. Delete the journal
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/api/journal/{}", journal_id))
                .method("DELETE")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    // 7. Get deleted journal - should return 404
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/api/journal/{}", journal_id))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn test_journal_create_validation() {
    let (app, _temp_db) = common::setup_test_app().await;

    // Missing date defaults to current timestamp
    let create_body = json!({
        "content": "Journal without explicit date"
    });
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/journal")
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
    assert!(created["date"].as_str().is_some());
}

#[tokio::test]
async fn test_journal_not_found() {
    let (app, _temp_db) = common::setup_test_app().await;

    // Get non-existent journal
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/journal/nonexistent_id")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NOT_FOUND);

    // Update non-existent journal
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/journal/nonexistent_id")
                .method("PATCH")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({"content": "Test"})).unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NOT_FOUND);

    // Delete non-existent journal
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/journal/nonexistent_id")
                .method("DELETE")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn test_journal_date_filtering() {
    let (app, _temp_db) = common::setup_test_app().await;

    // Create favorite and non-favorite journal entries
    let entries = [
        ("2026-06-01", true),
        ("2026-06-07", false),
        ("2026-06-15", true),
    ];
    for (date, is_favorite) in entries {
        let body = json!({
            "date": date,
            "content": format!("Entry for {}", date),
            "mood": "neutral",
            "isFavorite": is_favorite
        });
        app.clone()
            .oneshot(
                Request::builder()
                    .uri("/api/journal")
                    .method("POST")
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::to_vec(&body).unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap();
    }

    // Filter by isFavorite=true
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/journal?isFavorite=true")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body_bytes = response.into_body().collect().await.unwrap().to_bytes();
    let list: Value = serde_json::from_slice(&body_bytes).unwrap();
    let journals = list["entries"].as_array().unwrap();
    assert_eq!(journals.len(), 2);
    assert!(journals.iter().all(|j| j["isFavorite"] == true));
}

#[tokio::test]
async fn test_journal_mood_filtering() {
    let (app, _temp_db) = common::setup_test_app().await;

    // Create journals with different moods
    let moods = ["happy", "sad", "neutral"];
    for mood in moods {
        let body = json!({
            "date": "2026-06-07",
            "content": format!("Feeling {}", mood),
            "mood": mood
        });
        app.clone()
            .oneshot(
                Request::builder()
                    .uri("/api/journal")
                    .method("POST")
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::to_vec(&body).unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap();
    }

    // Filter by mood
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/journal?mood=happy")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body_bytes = response.into_body().collect().await.unwrap().to_bytes();
    let list: Value = serde_json::from_slice(&body_bytes).unwrap();
    let journals = list["entries"].as_array().unwrap();
    assert_eq!(journals.len(), 1);
    assert!(journals.iter().all(|j| j["mood"] == "happy"));
}
