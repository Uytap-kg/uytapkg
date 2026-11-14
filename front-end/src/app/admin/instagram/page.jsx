"use client";

import { useState, useEffect } from "react";
import {
  Check,
  Clock3,
  Search,
  ExternalLink,
  Camera,
  Loader2,
  Download,
} from "lucide-react";

import {
  getAdminInstagramRequests,
  completeInstagramRequest,
} from "@/utils/api";

import { downloadInstagramImages } from "@/utils/downloadInstagramImages";

import Header from "../components/Header/Header";
import Sidebar from "../components/Sidebar/Sidebar";

import styles from "./Instagram.module.css";

// --------------------------------------------------
// CONSTANTS
// --------------------------------------------------

const STATUS_LABELS = {
  pending: "На проверке",
  published: "Опубликовано",
};

const PROPERTY_TYPE_LABELS = {
  apartment: "Квартира",
  house: "Дом",
  land: "Участок",
  room: "Комната",
  commercial: "Коммерция",
  parking: "Паркинг / гараж",
};

// --------------------------------------------------
// HELPERS
// --------------------------------------------------

function formatPrice(price, currency) {
  if (price === null || price === undefined || price === "") {
    return "Цена не указана";
  }

  const numericPrice = Number(price);

  const formatted = Number.isFinite(numericPrice)
    ? new Intl.NumberFormat("ru-RU").format(numericPrice)
    : price;

  return `${formatted} ${currency || ""}`.trim();
}

function formatLocation(listing) {
  return (
    [listing?.district, listing?.address].filter(Boolean).join(", ") ||
    listing?.city ||
    ""
  );
}

function formatDate(value) {
  if (!value) return "";

  try {
    return new Date(value).toLocaleString("ru-RU", {
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return value;
  }
}

function getImageUrl(image) {
  if (typeof image === "string") {
    return image;
  }

  if (image && typeof image === "object") {
    return image.url || image.publicUrl || image.imageUrl || image.path || "";
  }

  return "";
}

// Получение всех фотографий объявления
function getListingImages(listing) {
  if (!listing) return [];

  const gallery = [
    ...(Array.isArray(listing.images) ? listing.images : []),
    ...(Array.isArray(listing.photos) ? listing.photos : []),
    ...(Array.isArray(listing.gallery) ? listing.gallery : []),
  ];

  const mainImage = getImageUrl(listing.image);

  const images = [mainImage, ...gallery.map(getImageUrl)].filter(Boolean);

  // Убираем повторяющиеся URL
  return [...new Set(images)];
}

// --------------------------------------------------
// MAP API RESPONSE
// --------------------------------------------------

function mapRequest(raw) {
  const listing = raw.listing;

  return {
    id: raw.id,
    status: raw.status,
    createdAt: formatDate(raw.createdAt),

    listing: listing
      ? {
          id: listing.id,
          title: listing.title || "Без названия",

          image: getImageUrl(listing.image),

          images: getListingImages(listing),

          description:
            listing.description ||
            listing.fullDescription ||
            listing.details ||
            "",

          type:
            PROPERTY_TYPE_LABELS[listing.propertyType] ||
            listing.propertyType ||
            "Недвижимость",

          location: formatLocation(listing),

          rooms: listing.rooms,

          area: listing.area ? `${listing.area} м²` : null,

          price: formatPrice(listing.price, listing.currency),

          status:
            listing.promotionStatus && listing.promotionStatus !== "regular"
              ? listing.promotionStatus
              : listing.isUrgent
                ? "urgent"
                : null,
        }
      : null,

    user: {
      name: raw.user?.name || "Пользователь",
      phone: raw.user?.phone || "Телефон не указан",
    },
  };
}

// --------------------------------------------------
// COMPONENT
// --------------------------------------------------

export default function InstagramPage() {
  const [requests, setRequests] = useState([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [publishingId, setPublishingId] = useState(null);
  const [downloadingId, setDownloadingId] = useState(null);

  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState("all");

  // --------------------------------------------------
  // LOAD REQUESTS
  // --------------------------------------------------

  useEffect(() => {
    loadRequests();
  }, []);

  async function loadRequests() {
    setLoading(true);
    setError("");

    const token = localStorage.getItem("uytap_token");

    if (!token) {
      setError("Требуется авторизация администратора");
      setLoading(false);
      return;
    }

    try {
      const data = await getAdminInstagramRequests(token);

      setRequests((Array.isArray(data) ? data : []).map(mapRequest));
    } catch (err) {
      console.error("Error loading Instagram requests:", err);

      setError(err.message || "Ошибка загрузки заявок Instagram");
    } finally {
      setLoading(false);
    }
  }

  // --------------------------------------------------
  // DOWNLOAD ALL IMAGES
  // --------------------------------------------------

  async function handleDownloadImages(request) {
    const listing = request.listing;

    if (!listing?.images?.length) {
      alert("У объявления нет фотографий");
      return;
    }

    if (downloadingId) return;

    setDownloadingId(request.id);

    try {
      await downloadInstagramImages(listing.images, listing.title);
    } catch (err) {
      console.error("Instagram image download error:", err);

      alert(
        err.message ||
          "Не удалось скачать фотографии. Проверь доступность изображений и настройки CORS.",
      );
    } finally {
      setDownloadingId(null);
    }
  }

  // --------------------------------------------------
  // PUBLISH REQUEST
  // --------------------------------------------------

  async function publishRequest(id) {
    const token = localStorage.getItem("uytap_token");

    if (!token || publishingId) return;

    setPublishingId(id);

    try {
      await completeInstagramRequest(token, id);

      setRequests((current) =>
        current.map((request) =>
          request.id === id
            ? {
                ...request,
                status: "published",
              }
            : request,
        ),
      );
    } catch (err) {
      console.error("Error completing Instagram request:", err);

      alert(err.message || "Не удалось обновить заявку");
    } finally {
      setPublishingId(null);
    }
  }

  // --------------------------------------------------
  // SEARCH AND FILTERS
  // --------------------------------------------------

  const filteredRequests = requests.filter((request) => {
    const matchesFilter =
      activeFilter === "all" || request.status === activeFilter;

    const query = search.toLowerCase().trim();

    if (!query) return matchesFilter;

    const searchableText = [
      request.listing?.title,
      request.listing?.location,
      request.user?.name,
      request.user?.phone,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return matchesFilter && searchableText.includes(query);
  });

  // --------------------------------------------------
  // STATISTICS
  // --------------------------------------------------

  const pendingCount = requests.filter(
    (request) => request.status === "pending",
  ).length;

  const publishedCount = requests.filter(
    (request) => request.status === "published",
  ).length;

  // --------------------------------------------------
  // RENDER
  // --------------------------------------------------

  return (
    <div className={styles.page}>
      <Sidebar />

      <div className={styles.content}>
        <Header
          title="Instagram"
          subtitle="Управление публикациями объявлений"
        />

        <main className={styles.main}>
          {/* TOP */}

          <section className={styles.top}>
            <div className={styles.titleBlock}>
              <div className={styles.titleIcon}>
                <Camera />
              </div>

              <div>
                <h1>Публикации Instagram</h1>

                <p>
                  Подготавливайте фотографии и тексты объявлений для публикации.
                </p>
              </div>
            </div>

            <div className={styles.stats}>
              <div className={styles.stat}>
                <strong>{pendingCount}</strong>
                <span>ожидают</span>
              </div>

              <div className={styles.stat}>
                <strong>{publishedCount}</strong>
                <span>опубликовано</span>
              </div>
            </div>
          </section>

          {/* CONTROLS */}

          <section className={styles.controls}>
            <div className={styles.search}>
              <Search />

              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Поиск по объявлению или пользователю..."
              />
            </div>

            <div className={styles.filters}>
              <button
                type="button"
                className={activeFilter === "all" ? styles.active : ""}
                onClick={() => setActiveFilter("all")}
              >
                Все
              </button>

              <button
                type="button"
                className={activeFilter === "pending" ? styles.active : ""}
                onClick={() => setActiveFilter("pending")}
              >
                <Clock3 />
                Ожидают
              </button>

              <button
                type="button"
                className={activeFilter === "published" ? styles.active : ""}
                onClick={() => setActiveFilter("published")}
              >
                <Check />
                Опубликовано
              </button>
            </div>
          </section>

          {/* LOADING */}

          {loading ? (
            <div className={styles.loading}>
              <Loader2 className={styles.spinIcon} size={32} />
            </div>
          ) : error ? (
            <div className={styles.error}>
              {error}

              <button type="button" onClick={loadRequests}>
                Повторить
              </button>
            </div>
          ) : filteredRequests.length > 0 ? (
            /* REQUESTS */

            <section className={styles.grid}>
              {filteredRequests.map((request) => {
                const isPublished = request.status === "published";

                const listing = request.listing;

                const isDownloading = downloadingId === request.id;

                const imageCount = listing?.images?.length || 0;

                const listingUrl = listing
                  ? `${window.location.origin}/all-products/${listing.id}`
                  : "";

                return (
                  <article
                    key={request.id}
                    className={`${styles.request} ${
                      isPublished ? styles.published : styles.pending
                    }`}
                  >
                    {/* REQUEST HEADER */}

                    <div className={styles.requestHeader}>
                      <div className={styles.requestUser}>
                        <div className={styles.avatar}>
                          {request.user.name.charAt(0).toUpperCase()}
                        </div>

                        <div className={styles.userInfo}>
                          <strong>{request.user.name}</strong>

                          <span>{request.user.phone}</span>
                        </div>
                      </div>

                      <div
                        className={`${styles.status} ${
                          isPublished
                            ? styles.statusPublished
                            : styles.statusPending
                        }`}
                      >
                        {isPublished ? <Check /> : <Clock3 />}

                        {STATUS_LABELS[request.status] || request.status}
                      </div>
                    </div>

                    {/* LISTING */}

                    {listing ? (
                      <>
                        <div className={styles.listing}>
                          {/* IMAGE AND DOWNLOAD */}

                          <div className={styles.imageColumn}>
                            <div className={styles.listingImage}>
                              {listing.image ? (
                                <img src={listing.image} alt={listing.title} />
                              ) : (
                                <div className={styles.noImage}>
                                  <Camera />
                                  <span>Нет фото</span>
                                </div>
                              )}

                              {listing.status && (
                                <span
                                  className={`${styles.listingBadge} ${
                                    styles[listing.status]
                                  }`}
                                >
                                  {listing.status === "vip" ? "VIP" : "Срочно"}
                                </span>
                              )}
                            </div>

                            <button
                              type="button"
                              className={styles.downloadButton}
                              disabled={
                                isDownloading ||
                                imageCount === 0 ||
                                downloadingId !== null
                              }
                              onClick={() => handleDownloadImages(request)}
                            >
                              {isDownloading ? (
                                <Loader2 className={styles.spinIcon} />
                              ) : (
                                <Download />
                              )}

                              {isDownloading
                                ? "Подготовка..."
                                : `Скачать фото (${imageCount})`}
                            </button>
                          </div>

                          {/* LISTING INFO */}

                          <div className={styles.listingContent}>
                            <span className={styles.listingType}>
                              {listing.type}
                            </span>

                            <h2>{listing.title}</h2>

                            <p className={styles.location}>
                              {listing.location || "Местоположение не указано"}
                            </p>

                            <div className={styles.specs}>
                              {listing.rooms && (
                                <span>{listing.rooms} комн.</span>
                              )}

                              {listing.area && <span>{listing.area}</span>}
                            </div>

                            <strong className={styles.price}>
                              {listing.price}
                            </strong>
                          </div>
                        </div>

                        {/* INSTAGRAM TEXT */}

                        <div className={styles.postText}>
                          <div className={styles.postTextHeader}>
                            <span>ТЕКСТ ДЛЯ INSTAGRAM</span>
                          </div>

                          <strong className={styles.postTitle}>
                            {listing.title}
                          </strong>

                          <strong className={styles.postPrice}>
                            {listing.price}
                          </strong>

                          <p className={styles.postDescription}>
                            {listing.description ||
                              "Описание объявления отсутствует."}
                          </p>

                          <a
                            href={`/all-products/${listing.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={styles.postLink}
                          >
                            Подробнее: {listingUrl}
                            <ExternalLink />
                          </a>
                        </div>
                      </>
                    ) : (
                      <div className={styles.deletedListing}>
                        <p>Объявление было удалено</p>
                      </div>
                    )}

                    {/* META */}

                    <div className={styles.meta}>
                      <div>
                        <span>Заявка создана</span>

                        <strong>{request.createdAt}</strong>
                      </div>

                      {listing && (
                        <a
                          href={`/all-products/${listing.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={styles.openButton}
                        >
                          <ExternalLink />
                          Объявление
                        </a>
                      )}
                    </div>

                    {/* PUBLISH STATUS */}

                    {!isPublished && (
                      <div className={styles.publishArea}>
                        <button
                          type="button"
                          className={styles.publishButton}
                          disabled={publishingId !== null}
                          onClick={() => publishRequest(request.id)}
                        >
                          {publishingId === request.id ? (
                            <Loader2 className={styles.spinIcon} />
                          ) : (
                            <Check />
                          )}

                          {publishingId === request.id
                            ? "Сохранение..."
                            : "Опубликовано"}
                        </button>
                      </div>
                    )}
                  </article>
                );
              })}
            </section>
          ) : (
            /* EMPTY */

            <div className={styles.empty}>
              <div className={styles.emptyIcon}>
                <Camera />
              </div>

              <h2>Заявок не найдено</h2>

              <p>Попробуйте изменить фильтр или поисковый запрос.</p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
