"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Home, ArrowLeft, AlertCircle } from "lucide-react";

import {
  getListingById,
  getFavorites,
  addFavorite,
  removeFavorite,
} from "@/utils/api";

import { mapListingDetail } from "@/utils/mapListingData";

import { useLanguage } from "@/context/LanguageContext";

import ProductGallery from "./components/ProductGallery/ProductGallery";
import ProductSummary from "./components/ProductSummary/ProductSummary";
import ProductInfo from "./components/ProductInfo/ProductInfo";

import styles from "./ProductDetails.module.css";

export default function ProductDetails() {
  const router = useRouter();
  const { id } = useParams();

  const { t, language } = useLanguage();

  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [currentImage, setCurrentImage] = useState(0);

  const [isFavorite, setIsFavorite] = useState(false);
  const [isFavoriteLoading, setIsFavoriteLoading] = useState(false);

  /*
   * ========================================================
   * BACK NAVIGATION
   * ========================================================
   */

  const handleBack = () => {
    try {
      const savedState = sessionStorage.getItem("uytap_return_state");

      if (savedState) {
        const parsedState = JSON.parse(savedState);

        const returnUrl = parsedState?.url;
        const scrollY = Number(parsedState?.scrollY) || 0;

        // Проверяем, что URL является внутренним маршрутом
        if (
          typeof returnUrl === "string" &&
          returnUrl.startsWith("/") &&
          !returnUrl.startsWith("//")
        ) {
          sessionStorage.setItem(
            "uytap_restore_scroll",
            JSON.stringify({ scrollY }),
          );

          router.push(returnUrl);
          return;
        }
      }
    } catch (err) {
      console.error("Error restoring previous page:", err);
    }

    // Если сохранённой страницы нет, используем обычный возврат
    if (window.history.length > 1) {
      router.back();
    } else {
      router.push("/all-products");
    }
  };

  /*
   * ========================================================
   * LOAD PRODUCT
   * ========================================================
   */

  useEffect(() => {
    if (!id) return;

    let mounted = true;

    setLoading(true);
    setError(null);

    getListingById(id)
      .then((res) => {
        if (!mounted) return;

        if (res.success && res.data) {
          setProduct(mapListingDetail(res.data));
        } else {
          setError(res.message || t("productDetails.notFound"));
        }
      })
      .catch((err) => {
        console.error("Fetch listing details error:", err);

        if (mounted) {
          setError(t("productDetails.loadError"));
        }
      })
      .finally(() => {
        if (mounted) {
          setLoading(false);
        }
      });

    const token = localStorage.getItem("uytap_token");

    if (token) {
      getFavorites(token)
        .then((res) => {
          if (!mounted) return;

          if (res.success && Array.isArray(res.data)) {
            const favorite = res.data.some(
              (listing) => String(listing.id) === String(id),
            );

            setIsFavorite(favorite);
          }
        })
        .catch((err) => {
          console.error("Error fetching favorites:", err);
        });
    }

    return () => {
      mounted = false;
    };
  }, [id, t]);

  /*
   * ========================================================
   * FAVORITE
   * ========================================================
   */

  const handleFavoriteToggle = async () => {
    const token = localStorage.getItem("uytap_token");

    if (!token) {
      router.push("/login");
      return;
    }

    if (isFavoriteLoading) return;

    setIsFavoriteLoading(true);

    try {
      if (isFavorite) {
        const res = await removeFavorite(token, id);

        if (res.success) {
          setIsFavorite(false);
        }
      } else {
        const res = await addFavorite(token, id);

        if (res.success) {
          setIsFavorite(true);
        }
      }
    } catch (err) {
      console.error("Error toggling favorite:", err);
    } finally {
      setIsFavoriteLoading(false);
    }
  };

  /*
   * ========================================================
   * LOADING
   * ========================================================
   */

  if (loading) {
    return (
      <main className={styles.page}>
        <div className={styles.loadingState}>
          <div className={styles.loadingSpinner} />

          <h2>{t("productDetails.loading.title")}</h2>

          <p>{t("productDetails.loading.description")}</p>
        </div>
      </main>
    );
  }

  /*
   * ========================================================
   * ERROR
   * ========================================================
   */

  if (error || !product) {
    return (
      <main className={styles.page}>
        <div className={styles.errorState}>
          <div className={styles.errorIcon}>
            <Home size={28} />
          </div>

          <h2>{t("productDetails.notFound")}</h2>

          <p>{error || t("productDetails.dataLoadFailed")}</p>

          <button
            type="button"
            className={styles.primaryButton}
            onClick={handleBack}
          >
            <ArrowLeft size={18} />
            {t("productDetails.backToListings")}
          </button>
        </div>
      </main>
    );
  }

  /*
   * ========================================================
   * IMAGES
   * ========================================================
   */

  const images =
    Array.isArray(product.images) && product.images.length > 0
      ? product.images
      : [
          "https://images.unsplash.com/photo-1564013799919-ab600027ffc6?q=80&w=1200",
        ];

  /*
   * ========================================================
   * RENDER
   * ========================================================
   */

  return (
    <main className={styles.page}>
      <div className={styles.container}>
        {/* BACK */}

        <button type="button" className={styles.back} onClick={handleBack}>
          <ArrowLeft size={18} />
          {t("productDetails.backToListings")}
        </button>

        {/* EXPIRED BANNER */}

        {product.isExpired && (
          <div className={styles.expiredBanner}>
            <AlertCircle size={22} className={styles.expiredBannerIcon} />

            <div className={styles.expiredBannerContent}>
              <strong className={styles.expiredBannerTitle}>
                {language === "ky"
                  ? "Бул кулактандыруунун жарыялоо мөөнөтү бүттү"
                  : "Срок публикации данного объявления истёк"}
              </strong>

              <p className={styles.expiredBannerText}>
                {language === "ky"
                  ? "Ал архивде жана актуалдуу болбой калышы мүмкүн."
                  : "Оно находится в архиве и может быть неактуально."}
              </p>
            </div>
          </div>
        )}

        {/* TOP */}

        <section className={styles.top}>
          <ProductGallery
            product={product}
            images={images}
            currentImage={currentImage}
            setCurrentImage={setCurrentImage}
            isFavorite={isFavorite}
            isFavoriteLoading={isFavoriteLoading}
            onFavoriteToggle={handleFavoriteToggle}
          />

          <ProductSummary product={product} />
        </section>

        {/* INFO */}

        <ProductInfo product={product} router={router} />
      </div>
    </main>
  );
}
