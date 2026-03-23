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

SCS_COORDS = [-29.7182, -52.4306]

# --- CONEXÃO G-SHEETS ---
from streamlit_gsheets import GSheetsConnection
conn = st.connection("gsheets", type=GSheetsConnection)

# ==========================================
# 🎨 FRONT-END: ESTILO "VIUMEU PET" (CSS)
# ==========================================
st.markdown("""
<style>
    /* Importando fonte moderna */
    @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;600&display=swap');
    
    html, body, [class*="css"] {
        font-family: 'Poppins', sans-serif;
    }

    /* Ajuste do fundo e container */
    .main {
        background-color: #f8f9fa;
    }

    /* HEADER / BANNER */
    .header-banner {
        width: 100% !important;
        border-radius: 20px !important;
        box-shadow: 0 4px 15px rgba(0,0,0,0.1);
        margin-bottom: 20px;
    }

    /* CARDS DE PETS - ESTILO PREMIUM */
    .pet-card {
        background: white;
        border-radius: 20px;
        padding: 15px;
        margin-bottom: 20px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.05);
        transition: transform 0.3s ease;
        display: flex;
        gap: 20px;
        border: 1px solid #eee;
    }
    .pet-card:hover {
        transform: translateY(-5px);
        box-shadow: 0 8px 20px rgba(0,0,0,0.1);
    }

    .foto-pet {
        width: 130px;
        height: 130px;
        border-radius: 15px;
        object-fit: cover;
    }

    .info-pet {
        flex: 1;
    }

    .nome-pet {
        color: #2c3e50;
        font-size: 1.4rem;
        font-weight: 600;
        margin: 0;
    }

    .tag-perdido {
        background-color: #ffe5e5;
        color: #ff4b4b;
        padding: 4px 12px;
        border-radius: 50px;
        font-size: 0.75rem;
        font-weight: 600;
        display: inline-block;
        margin-bottom: 8px;
    }

    .detalhe-item {
        font-size: 0.9rem;
        color: #7f8c8d;
        margin: 2px 0;
    }

    /* MAPA E BOTÕES */
    .stFolium {
        border-radius: 20px !important;
        overflow: hidden;
        box-shadow: 0 4px 12px rgba(0,0,0,0.1);
    }

    .stButton>button {
        border-radius: 50px !important;
        font-weight: 600 !important;
        transition: 0.3s !important;
    }
</style>
""", unsafe_allow_html=True)

# --- FUNÇÕES DE INTERFACE ---
def renderizar_header():
    banner_path = "assets/Banner.png"
    if os.path.exists(banner_path):
        with open(banner_path, "rb") as f:
            data = base64.b64encode(f.read()).decode()
            st.markdown(f'<img src="data:image/png;base64,{data}" class="header-banner">', unsafe_allow_html=True)
    st.write("")

@st.dialog("Sucesso!")
def modal_sucesso(mensagem, proxima_pagina='home'):
    st.write(f"### 🎉 {mensagem}")
    if st.button("OK", width='stretch', type="primary"):
        st.session_state.pagina = proxima_pagina
        st.rerun()

# --- LÓGICA DE DADOS ---
def ler_planilha(nome_aba):
    try:
        return conn.read(worksheet=nome_aba, ttl=15).dropna(how='all').fillna("")
    except: return pd.DataFrame()

def valor_seguro(linha, coluna):
    try: return str(linha[coluna]).strip() if str(linha[coluna]).strip() not in ['nan', ''] else '-'
    except: return '-'

# ==========================================
# 🛰️ GPS E NAVEGAÇÃO
# ==========================================
loc_gps = streamlit_js_eval(js_expressions="new Promise(resolve => navigator.geolocation.getCurrentPosition(pos => resolve({lat: pos.coords.latitude, lng: pos.coords.longitude})))", key="gps")
if loc_gps:
    st.session_state.user_lat, st.session_state.user_lng = loc_gps['lat'], loc_gps['lng']

with st.sidebar:
    st.markdown("## 🐾 Menu")
    if st.button("🏠 Mural de Pets", use_container_width=True): 
        st.session_state.pagina = 'home'; st.rerun()
    if st.button("🏆 Hall da Fama", use_container_width=True): 
        st.session_state.pagina = 'hall_fama'; st.rerun()
    st.divider()
    if not st.session_state.logado:
        u = st.text_input("Usuário")
        p = st.text_input("Senha", type="password")
        if st.button("Entrar", type="primary", use_container_width=True):
            df_u = ler_planilha(ABA_USUARIOS)
            user = df_u[(df_u['Usuario'].str.lower() == u.lower()) & (df_u['Senha'].astype(str) == p)].to_dict('records')
            if user: st.session_state.logado, st.session_state.user = True, user[0]; st.rerun()
            else: st.error("Erro no login")
        if st.button("Criar Conta", use_container_width=True): st.session_state.pagina = 'cadastro_user'; st.rerun()
    else:
        st.success(f"Olá, {st.session_state.user['Nome'].split()[0]}")
        if st.button("🐾 Meus Pets", use_container_width=True): st.session_state.pagina = 'meus_pets'; st.rerun()
        if st.button("🚪 Sair", use_container_width=True): st.session_state.logado = False; st.rerun()

# --- HEADER ---
renderizar_header()

# --- PÁGINA: HOME ---
if st.session_state.pagina == 'home':
    df = ler_planilha(ABA_PETS)
    df_avis = ler_planilha(ABA_AVISTAMENTOS)

    # 🚨 RADAR 1KM
    if st.session_state.user_lat and not df.empty:
        prox = 0
        for _, p in df[df['Status'] == 'Perdido'].iterrows():
            if geodesic((st.session_state.user_lat, st.session_state.user_lng), (p['Lat'], p['Lng'])).km <= 1.0: prox += 1
        if prox > 0: st.warning(f"🚨 **Radar PetAlerta:** Existem {prox} pets perdidos em um raio de 1km de você!")

    # MAPA
    m = folium.Map(location=SCS_COORDS, zoom_start=14, tiles='cartodbpositron')
    if st.session_state.user_lat:
        folium.Marker([st.session_state.user_lat, st.session_state.user_lng], icon=folium.Icon(color='blue', icon='user', prefix='fa')).add_to(m)
    
    for _, p in df[df['Status'] == 'Perdido'].iterrows():
        l, n = p['Lat'], p['Lng']
        folium.Marker([l, n], popup=p['Nome_Pet'], icon=folium.Icon(color='orange', icon='dog', prefix='fa')).add_to(m)
    
    st_folium(m, use_container_width=True, height=350)

    if st.session_state.logado:
        if st.button("🚨 REGISTRAR PET PERDIDO", type="primary", use_container_width=True):
            st.session_state.pagina = 'perdi_pet'; st.rerun()

    st.markdown("### 🔍 Desaparecidos em SCS")
    
    for _, pet in df[df['Status'] == 'Perdido'].iterrows():
        p_id = pet['ID']
        foto = pet['Foto']
        
        # HTML DO CARD ESTILO "VIUMEU PET"
        st.markdown(f"""
            <div class="pet-card">
                <img src="{foto}" class="foto-pet">
                <div class="info-pet">
                    <span class="tag-perdido">PERDIDO</span>
                    <h3 class="nome-pet">{pet['Nome_Pet']}</h3>
                    <p class="detalhe-item"><b>📍 Local:</b> {pet['Local_Desaparecimento']}</p>
                    <p class="detalhe-item"><b>🐾 Raça:</b> {pet['Raca']} | <b>🎨 Cor:</b> {pet['Cor']}</p>
                    <p class="detalhe-item"><b>🗓️ Data:</b> {pet['Data']}</p>
                </div>
            </div>
        """, unsafe_allow_html=True)
        
        # BOTÕES DE AÇÃO
        c1, c2, c3 = st.columns(3)
        with c1: 
            if st.button("👁️ Vi este pet!", key=f"v_{p_id}", use_container_width=True):
                st.session_state.pet_foco = pet; st.session_state.pagina = 'novo_avistamento'; st.rerun()
        with c2:
            if st.session_state.logado:
                tel = "".join(filter(str.isdigit, str(pet['Tel_Tutor'])))
                st.link_button("🟢 WhatsApp", f"https://wa.me/55{tel}", use_container_width=True)
            else: st.button("🔒 Login p/ Contato", disabled=True, use_container_width=True, key=f"l_{p_id}")
        with c3:
            if st.button("🗺️ Ver Rota", key=f"r_{p_id}", use_container_width=True):
                st.session_state.pet_foco = pet; st.session_state.pagina = 'historico_pet'; st.rerun()

# --- DEMAIS PÁGINAS MANTIDAS COM A NOVA ESTILIZAÇÃO ---
elif st.session_state.pagina == 'cadastro_user':
    st.markdown("### 📝 Criar Conta")
    with st.form("cad"):
        n = st.text_input("Nome Completo")
        u = st.text_input("Nome de Usuário")
        p = st.text_input("Senha", type="password")
        t = st.text_input("Telefone (com DDD)")
        if st.form_submit_button("CADASTRAR"):
            novo = pd.DataFrame([{"Usuario":u, "Senha":p, "Nome":n, "Telefone":t}])
            conn.update(worksheet=ABA_USUARIOS, data=pd.concat([ler_planilha(ABA_USUARIOS), novo], ignore_index=True))
            modal_sucesso("Conta criada! Faça o login na lateral.")
