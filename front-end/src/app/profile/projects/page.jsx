"use client";

import Image from "next/image";
import {
  Building2,
  CalendarDays,
  Edit,
  Eye,
  Home,
  Layers3,
  MapPin,
  MoreVertical,
  Plus,
  Trash2,
  TrendingUp,
  X,
  Save,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getMyComplexes,
  updateComplex as updateComplexApi,
  deleteComplex as deleteComplexApi,
} from "@/utils/api";

import { useLanguage } from "@/context/LanguageContext";

import styles from "./ResidentialComplexes.module.css";
import DeleteModal from "@/components/ui/deleteModal/DeleteMidal";
import CustomSelect from "@/components/ui/customSelect/CustomSelect";
import Header from "@/components/pageComponents/header/Header";

const statusValues = ["Проект", "Строительство", "Сдан"];

const classValues = ["Эконом", "Комфорт", "Бизнес", "Премиум"];

const statusClass = {
  Проект: "project",
  Строительство: "construction",
  Сдан: "completed",
};

const statusKeys = {
  "Все статусы": "all",
  Проект: "project",
  Строительство: "construction",
  Сдан: "completed",
};

const classKeys = {
  Эконом: "economy",
  Комфорт: "comfort",
  Бизнес: "business",
  Премиум: "premium",
};

export default function ResidentialComplexes() {
  const router = useRouter();
  const { t, language } = useLanguage();

  const [complexes, setComplexes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [status, setStatus] = useState("Все статусы");
  const [search, setSearch] = useState("");

  // ЖК для удаления
  const [deleteComplex, setDeleteComplex] = useState(null);

  // ЖК для редактирования
  const [editComplex, setEditComplex] = useState(null);

  // Данные формы редактирования
  const [editForm, setEditForm] = useState({
    name: "",
    address: "",
    status: "Строительство",
    class: "Комфорт",
    completionDate: "",
    floors: "",
    apartments: "",
    parking: "",
    area: "",
  });

  const statusOptions = statusValues;
  const editStatusOptions = statusValues;
  const classOptions = classValues;

  const translateStatus = (value) => {
    const key = statusKeys[value];

    if (!key) return value;

    return t(`residentialComplexes.statuses.${key}`);
  };

  const translateClass = (value) => {
    const key = classKeys[value];

    if (!key) return value;

    return t(`residentialComplexes.classes.${key}`);
  };

  const getCompletionLabel = (date) => {
    if (!date) return "";

    const [year, month] = date.split("-");

    const months = [
      "january",
      "february",
      "march",
      "april",
      "may",
      "june",
      "july",
      "august",
      "september",
      "october",
      "november",
      "december",
    ];

    const monthIndex = Number(month) - 1;

    if (!months[monthIndex]) return "";

    return `${t(`residentialComplexes.months.${months[monthIndex]}`)} ${year}`;
  };

  const getLocalizedStatusOptions = () =>
    statusOptions.map((value) => translateStatus(value));

  const getLocalizedClassOptions = () =>
    classOptions.map((value) => translateClass(value));

  const statusLabelToValue = (label) => {
    const value = statusValues.find((item) => translateStatus(item) === label);

    return value || "Строительство";
  };

  const classLabelToValue = (label) => {
    const value = classValues.find((item) => translateClass(item) === label);

    return value || "Комфорт";
  };

  const localizedStatusValue = translateStatus(status);

  const localizedEditStatusValue = translateStatus(editForm.status);
  const localizedEditClassValue = translateClass(editForm.class);

  useEffect(() => {
    const token = localStorage.getItem("uytap_token");

    if (!token) {
      router.push("/login");
      return;
    }

    getMyComplexes(token)
      .then((res) => {
        if (res.success && res.data) {
          const mapped = res.data.map((item) => {
            const compl = item;

            let completion_status = "Строительство";

            if (compl.completion_status === "planning") {
              completion_status = "Проект";
            }

            if (compl.completion_status === "completed") {
              completion_status = "Сдан";
            }

            const parseNumber = (val) => {
              if (!val) return 0;

              const n = parseInt(String(val).replace(/\D+/g, ""), 10);

              return isNaN(n) ? 0 : n;
            };

            return {
              id: compl.id,
              name: compl.name,
              address: compl.address,
              status: completion_status,
              class: compl.housing_class || "Комфорт",
              completionLabel: compl.completion_date || "",
              completionDate: compl.completion_date,
              floors: parseNumber(compl.features?.floors),
              apartments: parseNumber(compl.features?.apartments),
              parking: parseNumber(compl.features?.parking),
              area: compl.features?.areaSotka
                ? `${compl.features.areaSotka} соток`
                : compl.features?.area
                  ? `${compl.features.area} м²`
                  : "0 м²",
              image:
                compl.cover_photo ||
                "https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?auto=format&fit=crop&w=1200&q=85",
              amenities: compl.features?.amenities || [],
              rawFeatures: compl.features || {},
            };
          });

          setComplexes(mapped);
        } else {
          setError(res.message || t("residentialComplexes.errors.load"));
        }
      })
      .catch((err) => {
        console.error(err);

        setError(t("residentialComplexes.errors.loadServer"));
      })
      .finally(() => {
        setLoading(false);
      });
  }, [router, t]);

  const filteredComplexes = useMemo(() => {
    const query = search.trim().toLowerCase();

    return complexes.filter((item) => {
      const matchesStatus = status === "Все статусы" || item.status === status;

      const matchesSearch =
        !query ||
        item.name?.toLowerCase().includes(query) ||
        item.address?.toLowerCase().includes(query);

      return matchesStatus && matchesSearch;
    });
  }, [complexes, status, search]);

  const totalApartments = complexes.reduce(
    (sum, item) => sum + (Number(item.apartments) || 0),
    0,
  );

  const constructionCount = complexes.filter(
    (item) => item.status === "Строительство",
  ).length;

  // =========================================================
  // DELETE
  // =========================================================

  const handleDeleteClick = (item) => {
    setDeleteComplex(item);
  };

  const closeDeleteModal = () => {
    setDeleteComplex(null);
  };

  const confirmDelete = async () => {
    if (!deleteComplex) return;

    try {
      const token = localStorage.getItem("uytap_token");

      if (!token) {
        throw new Error(t("residentialComplexes.errors.unauthorized"));
      }

      const res = await deleteComplexApi(token, deleteComplex.id);

      if (!res.success) {
        throw new Error(res.message || t("residentialComplexes.errors.delete"));
      }

      setComplexes((prev) =>
        prev.filter((item) => item.id !== deleteComplex.id),
      );
    } catch (err) {
      alert(err.message || t("residentialComplexes.errors.delete"));
    } finally {
      setDeleteComplex(null);
    }
  };

  // =========================================================
  // EDIT
  // =========================================================

  const handleEditClick = (item) => {
    setEditComplex(item);

    setEditForm({
      name: item.name || "",
      address: item.address || "",
      status: item.status || "Строительство",
      class: item.class || "Комфорт",
      completionDate: item.completionDate || "",
      floors: item.floors ?? "",
      apartments: item.apartments ?? "",
      parking: item.parking ?? "",
      area: item.area
        ? String(item.area).replace(/\s?м²/g, "").replace(/\s/g, "")
        : "",
    });
  };

  const closeEditModal = () => {
    setEditComplex(null);
  };

  const handleEditChange = (e) => {
    const { name, value } = e.target;

    setEditForm((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const setEditField = (name, value) => {
    setEditForm((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const saveEdit = async () => {
    if (!editComplex) return;

    try {
      const token = localStorage.getItem("uytap_token");

      if (!token) {
        throw new Error(t("residentialComplexes.errors.unauthorized"));
      }

      const payload = {
        name: editForm.name,
        address: editForm.address,
        status: editForm.status,
        class: editForm.class,
        completionDate: editForm.completionDate,
        floors: Number(editForm.floors) || 0,
        apartments: Number(editForm.apartments) || 0,
        parking: Number(editForm.parking) || 0,
        area: Number(editForm.area) || 0,
      };

      const res = await updateComplexApi(token, editComplex.id, payload);

      if (!res.success) {
        throw new Error(res.message || t("residentialComplexes.errors.update"));
      }

      const compl = res.data;

      let completion_status = "Строительство";

      if (compl.completion_status === "planning") {
        completion_status = "Проект";
      }

      if (compl.completion_status === "completed") {
        completion_status = "Сдан";
      }

      const updated = {
        id: compl.id,
        name: compl.name,
        address: compl.address,
        status: completion_status,
        class: compl.housing_class || "Комфорт",
        completionLabel: compl.completion_date || "",
        completionDate: compl.completion_date,
        floors: compl.features?.floors || 0,
        apartments: compl.features?.apartments || 0,
        parking: compl.features?.parking || 0,
        area: compl.features?.area ? `${compl.features.area} м²` : "0 м²",
        image: compl.cover_photo || editComplex.image,
        amenities: compl.features?.amenities || editComplex.amenities,
        rawFeatures: compl.features || {},
      };

      setComplexes((prev) =>
        prev.map((item) => (item.id === editComplex.id ? updated : item)),
      );

      setEditComplex(null);
    } catch (err) {
      alert(err.message || t("residentialComplexes.errors.update"));
    }
  };

  return (
    <main className={styles.page}>
      <Header />
      <div className={styles.container}>
        <header className={styles.header}>
          <div className={styles.headerText}>
            <div className={styles.btns}>
              <span className={styles.eyebrow}>
                <Building2 />

                {t("residentialComplexes.header.eyebrow")}
              </span>
            </div>

            <h1>{t("residentialComplexes.header.title")}</h1>

            <p>{t("residentialComplexes.header.description")}</p>
          </div>

          <div className={styles.headerActions}>
            <button
              type="button"
              className={styles.addButton}
              onClick={() => router.push("/add-residential-complex")}
            >
              <Plus size={19} />

              {t("residentialComplexes.actions.add")}
            </button>
          </div>
        </header>

        {/* =========================================================
            OVERVIEW
        ========================================================= */}

        <section className={styles.overview}>
          <div className={styles.overviewCard}>
            <div className={styles.overviewIcon}>
              <Building2 />
            </div>

            <div>
              <span>{t("residentialComplexes.stats.total")}</span>

              <strong>{complexes.length}</strong>
            </div>
          </div>

          <div className={styles.overviewCard}>
            <div className={styles.overviewIcon}>
              <TrendingUp />
            </div>

            <div>
              <span>{t("residentialComplexes.stats.construction")}</span>

              <strong>{constructionCount}</strong>
            </div>
          </div>

          <div className={styles.overviewCard}>
            <div className={styles.overviewIcon}>
              <Home />
            </div>

            <div>
              <span>{t("residentialComplexes.stats.apartments")}</span>

              <strong>
                {totalApartments.toLocaleString(
                  language === "ky" ? "ky-KG" : "ru-RU",
                )}
              </strong>
            </div>
          </div>
        </section>

        {/* =========================================================
            FILTERS
        ========================================================= */}

        <section className={styles.filters}>
          <div className={styles.search}>
            <Building2 />

            <input
              type="text"
              placeholder={t("residentialComplexes.filters.searchPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className={styles.statusSelect}>
            <CustomSelect
              icon={TrendingUp}
              title={t("residentialComplexes.fields.status")}
              options={getLocalizedStatusOptions()}
              value={localizedStatusValue}
              setValue={(value) => {
                if (value === t("residentialComplexes.statuses.all")) {
                  setStatus("Все статусы");
                  return;
                }

                setStatus(statusLabelToValue(value));
              }}
            />
          </div>
        </section>

        {/* =========================================================
            RESULT
        ========================================================= */}

        <div className={styles.resultRow}>
          <div>
            <span>{t("residentialComplexes.result.title")}</span>

            <strong>{filteredComplexes.length}</strong>
          </div>

          <span className={styles.resultHint}>
            {t("residentialComplexes.result.hint")}
          </span>
        </div>

        {/* =========================================================
            GRID
        ========================================================= */}

        {loading ? (
          <div
            style={{
              textAlign: "center",
              padding: "60px 0",
              color: "#888",
              fontSize: "16px",
            }}
          >
            <span
              style={{
                display: "inline-block",
                border: "3px solid rgba(255,255,255,0.1)",
                borderTop: "3px solid #ff3d99",
                borderRadius: "50%",
                width: "30px",
                height: "30px",
                animation: "spin 1s linear infinite",
                marginBottom: "15px",
              }}
            />

            <div>{t("residentialComplexes.loading")}</div>

            <style>{`
              @keyframes spin {
                0% {
                  transform: rotate(0deg);
                }

                100% {
                  transform: rotate(360deg);
                }
              }
            `}</style>
          </div>
        ) : error ? (
          <div
            style={{
              color: "#e53e3e",
              background: "#fed7d7",
              padding: "15px",
              borderRadius: "10px",
              margin: "20px 0",
              textAlign: "center",
              border: "1px solid #feb2b2",
            }}
          >
            {error}
          </div>
        ) : filteredComplexes.length > 0 ? (
          <section className={styles.grid}>
            {filteredComplexes.map((item) => (
              <article key={item.id} className={styles.card}>
                {/* IMAGE */}

                <div className={styles.image}>
                  <Image
                    src={item.image}
                    fill
                    alt={item.name}
                    sizes="(max-width: 700px) 100vw, (max-width: 1100px) 50vw, 600px"
                  />

                  <div className={styles.imageOverlay} />

                  <div className={styles.topBadges}>
                    <span
                      className={`${styles.status} ${
                        styles[statusClass[item.status]]
                      }`}
                    >
                      <i />

                      {translateStatus(item.status)}
                    </span>

                    <span className={styles.classBadge}>
                      {translateClass(item.class)}
                    </span>
                  </div>

                  <button
                    type="button"
                    className={styles.moreButton}
                    onClick={(e) => {
                      e.stopPropagation();
                    }}
                    aria-label={t("residentialComplexes.actions.more")}
                  >
                    <MoreVertical />
                  </button>
                </div>

                {/* CONTENT */}

                <div className={styles.content}>
                  <div className={styles.titleRow}>
                    <div>
                      <h2>{item.name}</h2>

                      <div className={styles.location}>
                        <MapPin />

                        <span>{item.address}</span>
                      </div>
                    </div>
                  </div>

                  {/* SPECS */}

                  <div className={styles.specs}>
                    <div>
                      <Layers3 />

                      <span>
                        <b>{item.floors}</b>{" "}
                        {t("residentialComplexes.specs.floors")}
                      </span>
                    </div>

                    <div>
                      <Home />

                      <span>
                        <b>{item.apartments}</b>{" "}
                        {t("residentialComplexes.specs.apartments")}
                      </span>
                    </div>

                    <div>
                      <CalendarDays />

                      <span>
                        <b>{getCompletionLabel(item.completionDate)}</b>{" "}
                        {t("residentialComplexes.specs.completion")}
                      </span>
                    </div>
                  </div>

                  {/* AMENITIES */}

                  <div className={styles.amenities}>
                    {item.amenities.slice(0, 3).map((amenity) => (
                      <span key={amenity}>{amenity}</span>
                    ))}

                    {item.amenities.length > 3 && (
                      <span>+{item.amenities.length - 3}</span>
                    )}
                  </div>

                  {/* ACTIONS */}

                  <div className={styles.actions}>
                    <button
                      type="button"
                      className={styles.primaryAction}
                      onClick={() =>
                        router.push(`/profile/projects/${item.id}`)
                      }
                    >
                      <Eye />

                      {t("residentialComplexes.actions.details")}
                    </button>

                    <button
                      type="button"
                      className={styles.editAction}
                      onClick={() => handleEditClick(item)}
                      aria-label={`${t(
                        "residentialComplexes.actions.editAria",
                      )}: ${item.name}`}
                    >
                      <Edit />
                    </button>

                    <button
                      type="button"
                      className={styles.deleteAction}
                      onClick={() => handleDeleteClick(item)}
                      aria-label={`${t(
                        "residentialComplexes.actions.deleteAria",
                      )}: ${item.name}`}
                    >
                      <Trash2 />
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </section>
        ) : (
          <div className={styles.empty}>
            <div className={styles.emptyIcon}>
              <Building2 />
            </div>

            <h2>{t("residentialComplexes.empty.title")}</h2>

            <p>{t("residentialComplexes.empty.description")}</p>
          </div>
        )}

        {/* =========================================================
            DELETE MODAL
        ========================================================= */}

        <DeleteModal
          isOpen={Boolean(deleteComplex)}
          title={t("residentialComplexes.deleteModal.title")}
          description={
            deleteComplex
              ? `${t(
                  "residentialComplexes.deleteModal.descriptionStart",
                )}${deleteComplex.name}${t(
                  "residentialComplexes.deleteModal.descriptionEnd",
                )}`
              : ""
          }
          confirmText={t("residentialComplexes.deleteModal.confirm")}
          cancelText={t("residentialComplexes.deleteModal.cancel")}
          onClose={closeDeleteModal}
          onConfirm={confirmDelete}
        />

        {/* =========================================================
            EDIT MODAL
        ========================================================= */}

        {editComplex && (
          <div className={styles.editModalOverlay} onMouseDown={closeEditModal}>
            <div
              className={styles.editModal}
              onMouseDown={(e) => e.stopPropagation()}
            >
              {/* MODAL HEADER */}

              <div className={styles.editModalHeader}>
                <div>
                  <span className={styles.editModalEyebrow}>
                    <Edit />

                    {t("residentialComplexes.editModal.eyebrow")}
                  </span>

                  <h2>{t("residentialComplexes.editModal.title")}</h2>

                  <p>
                    {t("residentialComplexes.editModal.descriptionStart")}
                    {editComplex.name}
                    {t("residentialComplexes.editModal.descriptionEnd")}
                  </p>
                </div>

                <button
                  type="button"
                  className={styles.editModalClose}
                  onClick={closeEditModal}
                  aria-label={t("residentialComplexes.actions.close")}
                >
                  <X />
                </button>
              </div>

              {/* MODAL BODY */}

              <div className={styles.editModalBody}>
                <div className={styles.editGrid}>
                  {/* NAME */}

                  <div
                    className={`${styles.editField} ${styles.editFieldFull}`}
                  >
                    <label>
                      {t("residentialComplexes.fields.name")} <span>*</span>
                    </label>

                    <div className={styles.editInput}>
                      <Building2 />

                      <input
                        name="name"
                        value={editForm.name}
                        onChange={handleEditChange}
                        placeholder={t(
                          "residentialComplexes.fields.namePlaceholder",
                        )}
                      />
                    </div>
                  </div>

                  {/* ADDRESS */}

                  <div
                    className={`${styles.editField} ${styles.editFieldFull}`}
                  >
                    <label>
                      {t("residentialComplexes.fields.address")} <span>*</span>
                    </label>

                    <div className={styles.editInput}>
                      <MapPin />

                      <input
                        name="address"
                        value={editForm.address}
                        onChange={handleEditChange}
                        placeholder={t(
                          "residentialComplexes.fields.addressPlaceholder",
                        )}
                      />
                    </div>
                  </div>

                  {/* STATUS */}

                  <div className={styles.editField}>
                    <label>{t("residentialComplexes.fields.status")}</label>

                    <CustomSelect
                      icon={TrendingUp}
                      title={t("residentialComplexes.fields.status")}
                      options={getLocalizedStatusOptions()}
                      value={localizedEditStatusValue}
                      setValue={(value) =>
                        setEditField("status", statusLabelToValue(value))
                      }
                    />
                  </div>

                  {/* CLASS */}

                  <div className={styles.editField}>
                    <label>
                      {t("residentialComplexes.fields.housingClass")}
                    </label>

                    <CustomSelect
                      icon={Building2}
                      title={t("residentialComplexes.fields.class")}
                      options={getLocalizedClassOptions()}
                      value={localizedEditClassValue}
                      setValue={(value) =>
                        setEditField("class", classLabelToValue(value))
                      }
                    />
                  </div>

                  {/* DATE */}

                  <div className={styles.editField}>
                    <label>
                      {t("residentialComplexes.fields.completionDate")}
                    </label>

                    <div className={styles.editInput}>
                      <CalendarDays />

                      <input
                        type="date"
                        name="completionDate"
                        value={editForm.completionDate}
                        onChange={handleEditChange}
                      />
                    </div>
                  </div>

                  {/* FLOORS */}

                  <div className={styles.editField}>
                    <label>{t("residentialComplexes.fields.floors")}</label>

                    <div className={styles.editInput}>
                      <Layers3 />

                      <input
                        type="number"
                        name="floors"
                        min="1"
                        value={editForm.floors}
                        onChange={handleEditChange}
                      />
                    </div>
                  </div>

                  {/* APARTMENTS */}

                  <div className={styles.editField}>
                    <label>{t("residentialComplexes.fields.apartments")}</label>

                    <div className={styles.editInput}>
                      <Home />

                      <input
                        type="number"
                        name="apartments"
                        min="0"
                        value={editForm.apartments}
                        onChange={handleEditChange}
                      />
                    </div>
                  </div>

                  {/* PARKING */}

                  <div className={styles.editField}>
                    <label>{t("residentialComplexes.fields.parking")}</label>

                    <div className={styles.editInput}>
                      <span className={styles.editInputSimpleIcon}>P</span>

                      <input
                        type="number"
                        name="parking"
                        min="0"
                        value={editForm.parking}
                        onChange={handleEditChange}
                      />
                    </div>
                  </div>

                  {/* AREA */}

                  <div className={styles.editField}>
                    <label>{t("residentialComplexes.fields.area")}</label>

                    <div className={styles.editInput}>
                      <Layers3 />

                      <input
                        type="number"
                        name="area"
                        min="0"
                        value={editForm.area}
                        onChange={handleEditChange}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* MODAL FOOTER */}

              <div className={styles.editModalFooter}>
                <button
                  type="button"
                  className={styles.editCancel}
                  onClick={closeEditModal}
                >
                  {t("residentialComplexes.actions.cancel")}
                </button>

                <button
                  type="button"
                  className={styles.editSave}
                  onClick={saveEdit}
                >
                  <Save />

                  {t("residentialComplexes.actions.save")}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
