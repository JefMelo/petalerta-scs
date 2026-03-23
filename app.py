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

# 1. Configuração Inicial e Título da Aba
st.set_page_config(page_title="PetAlerta SCS", page_icon="🐾", layout="centered")

# --- CONFIGURAÇÕES TÉCNICAS E APIS ---
IMGBB_API_KEY = "54494e69c28056a133620f4e8be0ab72"
ABA_USUARIOS, ABA_PETS, ABA_AVISTAMENTOS = "Usuarios", "Dados", "Avistamentos"
geolocator = Nominatim(user_agent="PetAlertaSCS_Final_V2")
SCS_COORDS = [-29.7182, -52.4306]

# --- CONEXÃO G-SHEETS ---
from streamlit_gsheets import GSheetsConnection
conn = st.connection("gsheets", type=GSheetsConnection)

# --- INICIALIZAÇÃO DE ESTADOS (STATE) ---
for key in ['pagina', 'logado', 'user', 'user_lat', 'user_lng', 'temp_lat', 'temp_lng', 'map_address', 'pet_foco', 'pagina_detalhes']:
    if key not in st.session_state:
        st.session_state[key] = None if key in ['user_lat', 'user_lng', 'temp_lat', 'temp_lng', 'map_address', 'pet_foco', 'pagina_detalhes'] else False
if not st.session_state.pagina: st.session_state.pagina = 'home'

# ==========================================
# 🎨 FRONT-END: CSS PREMIUM FINAL (CORRIGIDO)
# ==========================================
st.markdown("""
<style>
    @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;600&display=swap');
    html, body, [class*="css"] { font-family: 'Poppins', sans-serif; }

    /* --- CORREÇÃO DO BANNER (SEM CORTES) --- */
    [data-testid="stImageWrapper"] {
        background-color: transparent !important;
        width: 100% !important;
        display: flex !important;
        justify-content: center !important;
    }
    [data-testid="stImageWrapper"] > img {
        max-width: 100% !important;
        border-radius: 15px !important;
        margin-bottom: 15px;
        box-shadow: 0 4px 10px rgba(0,0,0,0.1);
        
        /* A MÁGICA: Mostra a imagem inteira sem cortes, mantendo a proporção */
        object-fit: contain !important; 
        height: auto !important; 
        background-color: transparent !important;
    }

    /* --- CARD PREMIUM COM ALTURA FIXA --- */
    [data-testid="stVerticalBlockBorderWrapper"] {
        background-color: var(--secondary-background-color) !important;
        border: 1px solid rgba(128, 128, 128, 0.1) !important;
        border-radius: 20px !important;
        padding: 15px !important;
        
        /* Altura fixa para alinhar os cards na grade */
        height: 250px !important; 
        display: flex; flex-direction: column; justify-content: space-between;
        transition: 0.3s ease;
    }
    [data-testid="stVerticalBlockBorderWrapper"]:hover { transform: translateY(-3px); border: 1px solid #ff4b4b !important; }

    /* Imagem e Texto do Card */
    .stImage img { border-radius: 12px !important; height: 100px !important; object-fit: cover !important; }
    .nome-pet { color: var(--text-color) !important; font-size: 1.2rem !important; font-weight: 600 !important; margin: 0; }
    .tag-status { background-color: #ff4b4b; color: white; padding: 1px 8px; border-radius: 6px; font-size: 0.6rem; font-weight: 700; margin-left: 8px; vertical-align: middle; }
    
    /* --- CORREÇÃO DO TAMANHO DA FONTE DAS INFORMAÇÕES (MAIOR) --- */
    .info-container {
        font-size: 0.85rem; /* Aumentado para melhor legibilidade */
        color: var(--text-color);
        margin-top: 5px;
        overflow: hidden;
        height: 50px;
    }
    .info-label { opacity: 0.6; font-weight: 400; }
    .info-valor { font-weight: 500; }

    /* Botões Pequenos e Alinhados */
    .stButton>button { border-radius: 10px !important; font-size: 0.65rem !important; height: 32px !important; padding: 0px 5px !important; }
    .stFolium { border-radius: 20px !important; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
</style>
""", unsafe_allow_html=True)

# ==========================================
# 🛠️ FUNÇÕES CORE E BACKEND (RECUPERADAS)
# ==========================================
def ler_planilha(aba):
    try: return conn.read(worksheet=aba, ttl=5).dropna(how='all').fillna("")
    except: return pd.DataFrame()

def fazer_upload_imgbb(arquivo):
    if not arquivo: return "https://via.placeholder.com/300?text=Sem+Foto"
    try:
        url = f"https://api.imgbb.com/1/upload?key={IMGBB_API_KEY}"
        img_b64 = base64.b64encode(arquivo.getvalue()).decode('utf-8')
        response = requests.post(url, data={"image": img_b64})
        return response.json()["data"]["url"] if response.status_code == 200 else ""
    except: return ""

def obter_endereco(lat, lng):
    try:
        location = geolocator.reverse((lat, lng), timeout=5)
        if location:
            address = location.raw.get('address', {})
            return f"{address.get('road', 'Rua não ident.')}, {address.get('suburb', 'Bairro não ident.')}"
    except: return "Localização capturada"

def ir_para(p):
    st.session_state.pagina = p
    st.rerun()

# ==========================================
# 📢 MODAIS (POP-UPS DE SEGURANÇA)
# ==========================================
@st.dialog("Acesso Restrito 🔒")
def modal_login_requerido():
    st.warning("Para garantir a segurança dos tutores, você precisa estar logado para realizar esta ação.")
    if st.button("Criar Conta Gratuita", use_container_width=True, type="primary"):
        ir_para('cadastro_user')
    st.info("Se já possui conta, entre pelo menu lateral.")

@st.dialog("Sucesso!")
def modal_sucesso(msg, p='home'):
    st.success(msg)
    if st.button("OK", use_container_width=True): ir_para(p)

# ==========================================
# 🛰️ GPS E SIDEBAR (NAVEGAÇÃO COMPLETA)
# ==========================================
# Tenta capturar o GPS do usuário
loc_gps = streamlit_js_eval(js_expressions="new Promise(resolve => navigator.geolocation.getCurrentPosition(pos => resolve({lat: pos.coords.latitude, lng: pos.coords.longitude})))", key="gps")
if loc_gps: st.session_state.user_lat, st.session_state.user_lng = loc_gps['lat'], loc_gps['lng']

with st.sidebar:
    st.markdown("### 🐾 Menu PetAlerta")
    if st.button("🏠 Mural Início", use_container_width=True): ir_para('home')
    if st.button("🏆 Hall da Fama", use_container_width=True): ir_para('hall_fama')
    st.divider()
    if not st.session_state.logado:
        st.markdown("#### Entrar ou Cadastrar")
        u_in = st.text_input("Usuário")
        p_in = st.text_input("Senha", type="password")
        if st.button("Entrar", type="primary", use_container_width=True):
            df_u = ler_planilha(ABA_USUARIOS)
            user = df_u[(df_u['Usuario'].astype(str).str.lower() == u_in.lower()) & (df_u['Senha'].astype(str) == p_in)].to_dict('records')
            if user: st.session_state.logado, st.session_state.user = True, user[0]; st.rerun()
            else: st.error("Login inválido")
        if st.button("Criar Nova Conta", use_container_width=True): ir_para('cadastro_user')
    else:
        st.success(f"Olá, {st.session_state.user['Nome'].split()[0]}")
        if st.button("🐾 Meus Pets Cadastrados", use_container_width=True): ir_para('meus_pets')
        if st.button("🚪 Sair", use_container_width=True): st.session_state.logado = False; ir_para('home')

# --- RENDERIZAÇÃO DO BANNER (SEMPRE NO TOPO) ---
if os.path.exists("assets/Banner.png"):
    # use_container_width=True para garantir alinhamento responsivo
    st.image("assets/Banner.png", use_container_width=True)

# PÁGINA DE ZOOM DA FOTO (MODAL DE FOTO)
if st.session_state.pagina_detalhes:
    st.image(st.session_state.pagina_detalhes, use_container_width=True)
    if st.button("⬅️ VOLTAR AO MURAL", type="primary", use_container_width=True):
        st.session_state.pagina_detalhes = None; st.rerun()
    st.stop()

# ==========================================
# 🏠 PÁGINA: HOME (MURAL PREMIUM)
# ==========================================
if st.session_state.pagina == 'home':
    df_p = ler_planilha(ABA_PETS)
    df_a = ler_planilha(ABA_AVISTAMENTOS)

    # MAPA COM DIFERENCIAÇÃO DE ÍCONES (CÃO/GATO) E CORES (QUENTE/FRIO)
    m = folium.Map(location=SCS_COORDS, zoom_start=14, tiles='cartodbpositron')
    for _, pet in df_p[df_p['Status'] == 'Perdido'].iterrows():
        esp = str(pet['Especie']).lower()
        ic = 'dog' if 'cão' in esp or 'cao' in esp else 'cat' if 'gato' in esp else 'paw'
        avis_pet = df_a[df_a['ID_Pet'].astype(str) == str(pet['ID'])]
        lat, lng, cor = pet['Lat'], pet['Lng'], 'orange'
        if not avis_pet.empty:
            ultimo = avis_pet.iloc[-1]
            lat, lng, cor = ultimo['Lat'], ultimo['Lng'], 'red' # Vermelho se houve avistamento
        folium.Marker([lat, lng], popup=pet['Nome_Pet'], icon=folium.Icon(color=cor, icon=ic, prefix='fa')).add_to(m)
    
    st_folium(m, use_container_width=True, height=350)

    # Radar 1KM (Aviso se houver pet perdido por perto)
    if st.session_state.user_lat and not df_p.empty:
        prox = sum(1 for _, p in df_p[df_p['Status'] == 'Perdido'].iterrows() if geodesic((st.session_state.user_lat, st.session_state.user_lng), (p['Lat'], p['Lng'])).km <= 1.0)
        if prox > 0: st.warning(f"🚨 **Radar:** Existem {prox} pets desaparecidos num raio de 1km de você!")

    if st.session_state.logado:
        if st.button("🚨 REGISTRAR MEU PET PERDIDO", type="primary", use_container_width=True): ir_para('perdi_pet')

    st.subheader("🔍 Mural de Desaparecidos")
    for _, pet in df_p[df_p['Status'] == 'Perdido'].iterrows():
        p_id = str(pet['ID'])
        avis_pet = df_a[df_a['ID_Pet'].astype(str) == p_id]
        label_loc, valor_loc = ("Visto em:", f"{avis_pet.iloc[-1]['Bairro']} ({avis_pet.iloc[-1]['Data_Hora']})") if not avis_pet.empty else ("Sumiu em:", f"{pet['Local_Desaparecimento']} ({pet['Data']})")

        # CARD COM ALTURA FIXA E DESIGN PREMIUM
        with st.container(border=True):
            c_img, c_txt = st.columns([1, 2.2])
            with c_img: st.image(pet['Foto'], use_container_width=True)
            with c_txt:
                st.markdown(f"<div><span class='nome-pet'>{pet['Nome_Pet']}</span><span class='tag-status'>PERDIDO</span></div>", unsafe_allow_html=True)
                # Informações com fonte maior para legibilidade
                st.markdown(f"<div class='info-container'><span class='info-label'>{label_loc}</span> <span class='info-valor'>{valor_loc}</span><br><span class='info-label'>🐾 Info:</span> <span class='info-valor'>{pet['Especie']} | {pet['Raca']} ({pet['Cor']})</span></div>", unsafe_allow_html=True)
                
                # 🛠️ 4 BOTÕES LADO A LADO UNIFORMEMENTE
                st.write("")
                b1, b2, b3, b4 = st.columns(4)
                with b1: # FOTO (Público)
                    if st.button("🔍 Foto", key=f"f_{p_id}", use_container_width=True): 
                        st.session_state.pagina_detalhes = pet['Foto']; st.rerun()
                with b2: # ROTA (Público)
                    if st.button("🗺️ Rota", key=f"r_{p_id}", use_container_width=True): 
                        st.session_state.pet_foco = pet; ir_para('historico_pet')
                with b3: # VI ESTE PET! (Restrito a membros)
                    if st.button("👁️ Vi!", key=f"vi_{p_id}", use_container_width=True):
                        if st.session_state.logado:
                            st.session_state.pet_foco = pet; ir_para('novo_avistamento')
                        else: modal_login_requerido()
                with b4: # WHATS
