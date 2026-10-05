import io
import uuid
import numpy as np
from PIL import Image
from typing import List, Optional
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from supabase import create_client, Client
import json
import uuid
from typing import Optional


app = FastAPI(title="Family Tree API")

# React Frontend से कनेक्ट करने के लिए CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# === Supabase क्रेडेंशियल्स यहाँ डालो ===
SUPABASE_URL = "https://wuokvcjqlvyiohdleilk.supabase.co"
SUPABASE_KEY = " eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind1b2t2Y2pxbHZ5aW9oZGxlaWxrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA0MTczNzYsImV4cCI6MjEwNTk5MzM3Nn0.NpMly9RdgEcE0EouQZ8Sa8aGm4Q9tWIQJ5TJHCVLNhs"
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)


# --- Helper: OpenCV Face Crop & PIL Compression ---
def process_and_crop_avatar(image_bytes: bytes) -> bytes:
    nparr = np.frombuffer(image_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

    if img is None:
        return image_bytes

    # OpenCV Default Face Detector
    face_cascade = cv2.CascadeClassifier(
        cv2.data.haarcascades + 'haarcascade_frontalface_default.xml'
    )
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    faces = face_cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(30, 30))

    if len(faces) > 0:
        # सबसे बड़ा चेहरा चुनो
        faces = sorted(faces, key=lambda f: f[2] * f[3], reverse=True)
        x, y, w, h = faces[0]
        
        # थोड़ा पैडिंग (Padding) जोड़ो ताकि सिर ना कटे
        pad = int(w * 0.3)
        x1 = max(0, x - pad)
        y1 = max(0, y - pad)
        x2 = min(img.shape[1], x + w + pad)
        y2 = min(img.shape[0], y + h + pad)
        
        cropped = img[y1:y2, x1:x2]
    else:
        cropped = img

    # OpenCV (BGR) -> PIL (RGB)
    rgb_cropped = cv2.cvtColor(cropped, cv2.COLOR_BGR2RGB)
    pil_img = Image.fromarray(rgb_cropped)

    # 300x300 में रिसाइज और 85% क्वालिटी में कंप्रेस
    pil_img.thumbnail((300, 300))
    buffer = io.BytesIO()
    pil_img.save(buffer, format="JPEG", quality=85)
    return buffer.getvalue()


# --- API 1: पूरा फैमिली ट्री डेटा फेच करना ---
@app.get("/api/family-tree")
def get_family_tree():
    response = supabase.table("persons").select("*").execute()
    return {"persons": response.data}


# --- API 2: नया फैमिली मेंबर जोड़ना ---
@app.post("/api/person")
async def create_person(
    name: str = Form(...),
    gender: str = Form("M"),
    profession: Optional[str] = Form(None),
    current_city: Optional[str] = Form(None),
    native_place: Optional[str] = Form(None),
    bio: Optional[str] = Form(None),
    parent_ids: Optional[str] = Form(None),
    photo: Optional[UploadFile] = File(None)
):
    avatar_url = None
    if photo:
        try:
            file_bytes = await photo.read()
            # यूनीक नाम से Supabase स्टोरेज में फोटो डालना
            file_name = f"{uuid.uuid4()}_{photo.filename}"
            supabase.storage.from_("avatars").upload(
                file_name, 
                file_bytes, 
                {"content-type": photo.content_type}
            )
            avatar_url = supabase.storage.from_("avatars").get_public_url(file_name)
        except Exception as e:
            print("फोटो अपलोड एरर:", e)

    parsed_parents = []
    if parent_ids:
        try:
            parsed = json.loads(parent_ids)
            if isinstance(parsed, list):
                parsed_parents = [str(pid) for pid in parsed if pid]
            else:
                parsed_parents = [str(parsed)]
        except:
            parsed_parents = [str(parent_ids)]

    data = {
        "name": name,
        "gender": gender,
        "profession": profession or "",
        "current_city": current_city or "",
        "native_place": native_place or "",
        "bio": bio or "",
        "avatar_url": avatar_url,
        "parent_ids": parsed_parents
    }

    try:
        res = supabase.table("persons").insert(data).execute()
        return {"success": True, "person": res.data}
    except Exception as e:
        print("इन्सर्ट एरर:", e)
        raise HTTPException(status_code=500, detail=str(e))


# --- API 3: किसी सदस्य के माता-पिता जोड़ना (ऊपर जोड़ने पर) ---
@app.put("/api/person/{person_id}/add-parent")
def add_parent_to_existing(person_id: str, parent_id: str = Form(...)):
    try:
        cur = supabase.table("persons").select("parent_ids").eq("id", person_id).execute()
        existing_parents = []
        if cur.data and len(cur.data) > 0 and cur.data[0].get("parent_ids"):
            existing_parents = cur.data[0]["parent_ids"]
            if not isinstance(existing_parents, list):
                existing_parents = [str(existing_parents)]
        
        if str(parent_id) not in [str(p) for p in existing_parents]:
            existing_parents.append(str(parent_id))
        
        supabase.table("persons").update({"parent_ids": existing_parents}).eq("id", person_id).execute()
        return {"success": True}
    except Exception as e:
        print("Add parent एरर:", e)
        raise HTTPException(status_code=500, detail=str(e))


# --- API 4: सदस्य डिलीट करना ---
@app.delete("/api/person/{person_id}")
def delete_person(person_id: str):
    try:
        supabase.table("persons").delete().eq("id", person_id).execute()
        return {"success": True, "message": "सदस्य हटा दिया गया"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
