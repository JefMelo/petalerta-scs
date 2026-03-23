import streamlit as st
import pandas as pd
from datetime import datetime
import requests
import base64
import folium
from streamlit_folium import st_folium
from streamlit_js_eval import streamlit_js_eval
from geopy.distance import geodesic
from geopy.geocoders import Nominatim
import os

# 1. Configuração Inicial
st.set_page_config(page_title="PetAlerta SCS", page_icon="🐾", layout="centered")

# --- CONFIGURAÇÕES TÉCNICAS ---
SHEET_ID = "1RyredbJZsCPQvBxXqYmX1vBZJRgYToffm5agPxDBDRk"
IMGBB_API_KEY = "54494e69c28056a133620f4e8be0ab72"
ABA_USUARIOS = "Usuarios"
ABA_PETS = "Dados" 
ABA_AVISTAMENTOS = "Avistamentos"

geolocator = Nominatim(user_agent="PetAlertaSCS_App")

# --- INICIALIZAÇÃO DE ESTADOS ---
if 'pagina' not in st.session_state: st.session_state.pagina = 'home'
if 'logado' not in st.session_state: st.session_state.logado = False
if 'user' not in st.session_state: st.session_state.user = {}
if 'user_lat' not in st.session_state: st.session_state.user_lat = None
if 'user_lng' not in st.session_state: st.session_state.user_lng = None
if 'pagina_detalhes' not in st.session_state: st.session_state.pagina_detalhes = None
if 'pet_foco' not in st.session_state: st.session_state.pet_foco = None

SCS_COORDS = [-29.7182, -52.4306]

# --- CONEXÃO G-SHEETS ---
from streamlit_gsheets import GSheetsConnection
conn = st.connection("gsheets", type=GSheetsConnection)

# ==========================================
# 🎨 FRONT-END: CSS ESTILO PREMIUM (V2)
# ==========================================
st.markdown("""
<style>
    @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;600&display=swap');
    
    html, body, [class*="css"] { font-family: 'Poppins', sans-serif; }

    /* Banner e Header */
    .header-banner {
        width: 100% !important;
        border-radius: 15px !important;
        margin-bottom: 10px;
    }

    /* Ajuste para Texto no Modo Escuro */
    .nome-pet {
        color: var(--text-color) !important;
        font-size: 1.5rem !important;
        font-weight: 600 !important;
        margin-bottom: 5px !important;
    }

    .tag-status {
        background-color: #ff4b4b;
        color: white;
        padding: 2px 10px;
        border-radius: 10px;
        font-size: 0.7rem;
        font-weight: bold;
        text-transform: uppercase;
    }

    .info-texto {
        color: var(--text-color);
        opacity: 0.8;
        font-size: 0.9rem;
        margin: 2px 0;
    }

    /* Estilização do container para parecer um Card */
    [data-testid="stVerticalBlockBorderWrapper"] {
        border: 1px solid rgba(128, 128, 128, 0.2) !important;
        border-radius: 20px !important;
        padding: 15px !important;
        background-color: var(--secondary-background-color) !important;
        transition: 0.3s;
    }
    
    [data-testid="stVerticalBlockBorderWrapper"]:hover {
        box-shadow: 0 4px 15px rgba(0,0,0,0.1);
    }

    /* Botões redondos e modernos */
    .stButton>button {
        border-radius: 20px !important;
        font-size: 0.8rem !important;
        height: 35px !important;
    }
</style>
""", unsafe_allow_html=True)

# --- FUNÇÕES GLOBAIS ---
def renderizar_header():
    banner_path = "assets/Banner.png"
    if os.path.exists(banner_path):
        with open(banner_path, "rb") as f:
            data = base64.b64encode(f.read()).decode()
            st.markdown(f'<img src="data:image/png;base64,{data}" class="header-banner">', unsafe_allow_html=True)
    st.write("")

def ler_planilha(aba):
    try: return conn.read(worksheet=aba, ttl=10).dropna(how='all').fillna("")
    except: return pd.DataFrame()

def valor_seguro(linha, col):
    try: return str(linha[col]).strip() if str(linha[col]).strip() not in ['nan', ''] else '-'
    except: return '-'

@st.dialog("Sucesso!")
def modal_sucesso(msg):
    st.success(msg)
    if st.button("OK", use_container_width=True): st.rerun()

# ==========================================
# 🛰️ GPS E SIDEBAR
# ==========================================
loc_gps = streamlit_js_eval(js_expressions="new Promise(resolve => navigator.geolocation.getCurrentPosition(pos => resolve({lat: pos.coords.latitude, lng: pos.coords.longitude})))", key="gps")
if loc_gps: st.session_state.user_lat, st.session_state.user_lng = loc_gps['lat'], loc_gps['lng']

with st.sidebar:
    st.markdown("## 🐾 Menu")
    if st.button("🏠 Início", use_container_width=True): st.session_state.pagina = 'home'; st.rerun()
    if st.button("🏆 Hall da Fama", use_container_width=True): st.session_state.pagina = 'hall_fama'; st.rerun()
    st.divider()
    if not st.session_state.logado:
        u = st.text_input("Usuário")
        p = st.text_input("Senha", type="password")
        if st.button("Entrar", type="primary", use_container_width=True):
            df_u = ler_planilha(ABA_USUARIOS)
            user = df_u[(df_u['Usuario'].astype(str).str.lower() == u.lower()) & (df_u['Senha'].astype(str) == p)].to_dict('records')
            if user: st.session_state.logado, st.session_state.user = True, user[0]; st.rerun()
            else: st.error("Login inválido")
        if st.button("Criar Conta", use_container_width=True): st.session_state.pagina = 'cadastro_user'; st.rerun()
    else:
        st.success(f"Olá, {st.session_state.user['Nome'].split()[0]}")
        if st.button("🚪 Sair", use_container_width=True): st.session_state.logado = False; st.rerun()

# --- HEADER ---
renderizar_header()

# --- PÁGINA DE ZOOM ---
if st.session_state.pagina_detalhes:
    st.image(st.session_state.pagina_detalhes, use_container_width=True)
    if st.button("⬅️ VOLTAR", use_container_width=True, type="primary"):
        st.session_state.pagina_detalhes = None; st.rerun()
    st.stop()

# ==========================================
# PÁGINA: HOME
# ==========================================
if st.session_state.pagina == 'home':
    df_pets = ler_planilha(ABA_PETS)
    df_avis = ler_planilha(ABA_AVISTAMENTOS)

    # MAPA COM ÍCONES DIFERENCIADOS
    m = folium.Map(location=SCS_COORDS, zoom_start=14, tiles='cartodbpositron')
    
    if st.session_state.user_lat:
        folium.Marker([st.session_state.user_lat, st.session_state.user_lng], icon=folium.Icon(color='blue', icon='user', prefix='fa')).add_to(m)

    for _, p in df_pets[df_pets['Status'] == 'Perdido'].iterrows():
        esp = str(p['Especie']).lower()
        # DIFERENCIAÇÃO DE ÍCONES
        ic = 'dog' if 'cão' in esp or 'cao' in esp else 'cat' if 'gato' in esp else 'paw'
        cor = 'orange'
        
        # Se houver avistamento, muda cor para vermelho e usa a última posição
        avis_pet = df_avis[df_avis['ID_Pet'].astype(str) == str(p['ID'])]
        lat, lng = p['Lat'], p['Lng']
        if not avis_pet.empty:
            ultimo = avis_pet.iloc[-1]
            lat, lng, cor = ultimo['Lat'], ultimo['Lng'], 'red'
        
        folium.Marker([lat, lng], popup=p['Nome_Pet'], icon=folium.Icon(color=cor, icon=ic, prefix='fa')).add_to(m)
    
    st_folium(m, use_container_width=True, height=350)

    if st.session_state.logado:
        if st.button("🚨 REGISTRAR NOVO PET PERDIDO", type="primary", use_container_width=True):
            st.session_state.pagina = 'perdi_pet'; st.rerun()

    st.markdown("### 🔍 Mural de Desaparecidos")
    
    for _, pet in df_pets[df_pets['Status'] == 'Perdido'].iterrows():
        p_id = str(pet['ID'])
        
        # Busca último avistamento para o card
        avis_pet = df_avis[df_avis['ID_Pet'].astype(str) == p_id]
        if not avis_pet.empty:
            u = avis_pet.iloc[-1]
            visto_texto = f"🚨 **Visto por último em:** {u['Bairro']} ({u['Data_Hora']})"
        else:
            visto_texto = f"📍 **Sumiu em:** {pet['Local_Desaparecimento']} ({pet['Data']})"

        # INÍCIO DO CARD
        with st.container(border=True):
            col_img, col_info = st.columns([1, 2])
            
            with col_img:
                st.image(pet['Foto'], use_container_width=True)
            
            with col_info:
                st.markdown(f"<span class='tag-status'>PERDIDO</span>", unsafe_allow_html=True)
                st.markdown(f"<div class='nome-pet'>{pet['Nome_Pet']}</div>", unsafe_allow_html=True)
                st.markdown(f"<div class='info-texto'>{visto_texto}</div>", unsafe_allow_html=True)
                st.markdown(f"<div class='info-texto'>🐾 {pet['Especie']} | {pet['Raca']} ({pet['Cor']})</div>", unsafe_allow_html=True)
                
                st.write("") # Espaçador
                
                # BOTÕES DENTRO DO CARD
                bt1, bt2, bt3 = st.columns(3)
                with bt1:
                    if st.button("👁️ Vi!", key=f"vi_{p_id}", use_container_width=True):
                        st.session_state.pet_foco = pet; st.session_state.pagina = 'novo_avistamento'; st.rerun()
                with bt2:
                    if st.button("🔍 Foto", key=f"f_{p_id}", use_container_width=True):
                        st.session_state.pagina_detalhes = pet['Foto']; st.rerun()
                with bt3:
                    if st.button("🗺️ Rota", key=f"r_{p_id}", use_container_width=True):
                        st.session_state.pet_foco = pet; st.session_state.pagina = 'historico_pet'; st.rerun()
                
                # BOTÃO WHATSAPP (Abaixo dos outros para não apertar)
                if st.session_state.logado:
                    tel = "".join(filter(str.isdigit, str(pet['Tel_Tutor'])))
                    st.link_button("🟢 Falar com Tutor", f"https://wa.me/55{tel}", use_container_width=True)
                else:
                    st.button("🔒 Login p/ Contato", disabled=True, use_container_width=True, key=f"lock_{p_id}")

# --- PÁGINAS RESTANTES (REGISTRO, AVISTAMENTO, ETC) ---
elif st.session_state.pagina == 'perdi_pet':
    st.markdown("### 🚨 Registrar Pet Perdido")
    if st.button("⬅️ Voltar"): st.session_state.pagina = 'home'; st.rerun()
    # ... Lógica de formulário igual ao anterior ...

elif st.session_state.pagina == 'novo_avistamento':
    p = st.session_state.pet_foco
    st.markdown(f"### 👁️ Vi o pet: {p['Nome_Pet']}")
    if st.button("⬅️ Voltar"): st.session_state.pagina = 'home'; st.rerun()
    # ... Lógica de registro de avistamento ...
