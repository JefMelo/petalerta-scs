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

geolocator = Nominatim(user_agent="PetAlertaSCS_App_V3")

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
# 🎨 FRONT-END: CSS PREMIUM (DARK/LIGHT MODE)
# ==========================================
st.markdown("""
<style>
    @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;600&display=swap');
    
    html, body, [class*="css"] { font-family: 'Poppins', sans-serif; }

    /* Banner */
    .header-banner {
        width: 100% !important;
        border-radius: 20px !important;
        margin-bottom: 20px;
        box-shadow: 0 4px 15px rgba(0,0,0,0.1);
    }

    /* Container do Card (Streamlit) */
    [data-testid="stVerticalBlockBorderWrapper"] {
        background-color: var(--secondary-background-color) !important;
        border: 1px solid rgba(128, 128, 128, 0.1) !important;
        border-radius: 25px !important;
        padding: 20px !important;
        transition: all 0.3s ease-in-out !important;
        box-shadow: 0 4px 12px rgba(0,0,0,0.05) !important;
    }
    
    [data-testid="stVerticalBlockBorderWrapper"]:hover {
        transform: translateY(-5px) !important;
        box-shadow: 0 12px 24px rgba(0,0,0,0.1) !important;
        border: 1px solid #ff4b4b !important;
    }

    /* Foto do Pet no Card */
    .img-card {
        border-radius: 18px;
        object-fit: cover;
        width: 100%;
        height: 160px;
        margin-bottom: 10px;
    }

    /* Tipografia do Card */
    .nome-pet {
        color: var(--text-color) !important;
        font-size: 1.6rem !important;
        font-weight: 600 !important;
        margin: 0px 0px 5px 0px !important;
        line-height: 1.2 !important;
    }

    .tag-status {
        background-color: #ff4b4b;
        color: white;
        padding: 3px 12px;
        border-radius: 50px;
        font-size: 0.7rem;
        font-weight: 700;
        display: inline-block;
        margin-bottom: 10px;
        letter-spacing: 0.5px;
    }

    .info-label {
        font-size: 0.85rem;
        color: var(--text-color);
        opacity: 0.7;
        margin-bottom: 2px;
    }

    .info-valor {
        font-size: 0.95rem;
        color: var(--text-color);
        font-weight: 500;
        margin-bottom: 8px;
    }

    /* Estilo do Mapa */
    .stFolium {
        border-radius: 25px !important;
        box-shadow: 0 4px 15px rgba(0,0,0,0.1);
    }

    /* Botões Modernos */
    .stButton>button {
        border-radius: 15px !important;
        border: none !important;
        font-weight: 600 !important;
        transition: 0.2s !important;
        height: 42px !important;
    }
    
    /* Botão Primário (Ação) */
    [data-testid="stBaseButton-primary"] {
        background-color: #ff4b4b !important;
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
    try: return conn.read(worksheet=aba, ttl=5).dropna(how='all').fillna("")
    except: return pd.DataFrame()

def ir_para(p):
    st.session_state.pagina = p
    st.rerun()

# ==========================================
# 🛰️ GPS E NAVEGAÇÃO
# ==========================================
loc_gps = streamlit_js_eval(js_expressions="new Promise(resolve => navigator.geolocation.getCurrentPosition(pos => resolve({lat: pos.coords.latitude, lng: pos.coords.longitude})))", key="gps")
if loc_gps: st.session_state.user_lat, st.session_state.user_lng = loc_gps['lat'], loc_gps['lng']

with st.sidebar:
    st.markdown("# 🐾 Menu")
    if st.button("🏠 Mural Início", use_container_width=True): ir_para('home')
    if st.button("🏆 Hall da Fama", use_container_width=True): ir_para('hall_fama')
    st.divider()
    if not st.session_state.logado:
        u = st.text_input("Usuário")
        p = st.text_input("Senha", type="password")
        if st.button("Entrar", type="primary", use_container_width=True):
            df_u = ler_planilha(ABA_USUARIOS)
            user = df_u[(df_u['Usuario'].astype(str).str.lower() == u.lower()) & (df_u['Senha'].astype(str) == p)].to_dict('records')
            if user: st.session_state.logado, st.session_state.user = True, user[0]; st.rerun()
            else: st.error("Erro no login")
        if st.button("Criar Conta", use_container_width=True): ir_para('cadastro_user')
    else:
        st.success(f"Logado como: {st.session_state.user['Nome'].split()[0]}")
        if st.button("🐾 Meus Pets", use_container_width=True): ir_para('meus_pets')
        if st.button("🚪 Sair", use_container_width=True): st.session_state.logado = False; st.rerun()

# --- HEADER SEMPRE NO TOPO ---
renderizar_header()

# --- PÁGINA DE ZOOM ---
if st.session_state.pagina_detalhes:
    st.image(st.session_state.pagina_detalhes, use_container_width=True)
    if st.button("⬅️ VOLTAR AO MURAL", use_container_width=True, type="primary"):
        st.session_state.pagina_detalhes = None; st.rerun()
    st.stop()

# ==========================================
# PÁGINA: HOME (O MURAL PREMIUM)
# ==========================================
if st.session_state.pagina == 'home':
    df_pets = ler_planilha(ABA_PETS)
    df_avis = ler_planilha(ABA_AVISTAMENTOS)

    # 🚨 RADAR 1KM (BANNER ALERTA)
    if st.session_state.user_lat and not df_pets.empty:
        prox = sum(1 for _, p in df_pets[df_pets['Status'] == 'Perdido'].iterrows() if geodesic((st.session_state.user_lat, st.session_state.user_lng), (p['Lat'], p['Lng'])).km <= 1.0)
        if prox > 0: st.warning(f"🚨 **Radar:** Existem {prox} pets desaparecidos num raio de 1km de você!")

    # MAPA COM DIFERENCIAÇÃO DE ÍCONES
    m = folium.Map(location=SCS_COORDS, zoom_start=14, tiles='cartodbpositron')
    if st.session_state.user_lat:
        folium.Marker([st.session_state.user_lat, st.session_state.user_lng], icon=folium.Icon(color='blue', icon='user', prefix='fa')).add_to(m)

    for _, p in df_pets[df_pets['Status'] == 'Perdido'].iterrows():
        esp = str(p['Especie']).lower()
        ic = 'dog' if 'cão' in esp or 'cao' in esp else 'cat' if 'gato' in esp else 'paw'
        
        # Lógica de Avistamento no Mapa
        avis_pet = df_avis[df_avis['ID_Pet'].astype(str) == str(p['ID'])]
        lat, lng, cor = p['Lat'], p['Lng'], 'orange'
        if not avis_pet.empty:
            ultimo = avis_pet.iloc[-1]
            lat, lng, cor = ultimo['Lat'], ultimo['Lng'], 'red'
        
        folium.Marker([lat, lng], popup=f"{p['Nome_Pet']} ({p['Especie']})", icon=folium.Icon(color=cor, icon=ic, prefix='fa')).add_to(m)
    
    st_folium(m, use_container_width=True, height=380)

    if st.session_state.logado:
        st.write("")
        if st.button("🚨 REGISTRAR NOVO PET PERDIDO", type="primary", use_container_width=True): ir_para('perdi_pet')

    st.markdown("### 🔍 Mural de Desaparecidos")
    
    # RENDERIZAÇÃO DOS CARDS PREMIUM
    for _, pet in df_pets[df_pets['Status'] == 'Perdido'].iterrows():
        p_id = str(pet['ID'])
        
        # Lógica de Informação: Visto por último ou Sumiu em
        avis_pet = df_avis[df_avis['ID_Pet'].astype(str) == p_id]
        if not avis_pet.empty:
            u = avis_pet.iloc[-1]
            visto_label = "🚨 Visto por último em:"
            visto_valor = f"{u['Bairro']} ({u['Data_Hora']})"
        else:
            visto_label = "📍 Sumiu em:"
            visto_valor = f"{pet['Local_Desaparecimento']} ({pet['Data']})"

        # ESTRUTURA DO CARD PREMIUM
        with st.container(border=True):
            col_img, col_info = st.columns([1.2, 2])
            
            with col_img:
                # Foto com classe CSS para arredondamento
                st.image(pet['Foto'], use_container_width=True)
            
            with col_info:
                st.markdown(f"<span class='tag-status'>PERDIDO</span>", unsafe_allow_html=True)
                st.markdown(f"<div class='nome-pet'>{pet['Nome_Pet']}</div>", unsafe_allow_html=True)
                
                # Informações limpas (sem símbolos de markdown soltos)
                st.markdown(f"<div class='info-label'>{visto_label}</div>", unsafe_allow_html=True)
                st.markdown(f"<div class='info-valor'>{visto_valor}</div>", unsafe_allow_html=True)
                
                st.markdown(f"<div class='info-label'>🐾 Espécie e Raça:</div>", unsafe_allow_html=True)
                st.markdown(f"<div class='info-valor'>{pet['Especie']} | {pet['Raca']} ({pet['Cor']})</div>", unsafe_allow_html=True)
                
                # BOTÕES DE AÇÃO INTEGRADOS NO CARD
                st.write("")
                btn_col1, btn_col2, btn_col3 = st.columns(3)
                with btn_col1:
                    if st.button("👁️ Vi!", key=f"vi_{p_id}", use_container_width=True):
                        st.session_state.pet_foco = pet; ir_para('novo_avistamento')
                with btn_col2:
                    if st.button("🔍 Foto", key=f"f_{p_id}", use_container_width=True):
                        st.session_state.pagina_detalhes = pet['Foto']; st.rerun()
                with btn_col3:
                    if st.button("🗺️ Rota", key=f"r_{p_id}", use_container_width=True):
                        st.session_state.pet_foco = pet; ir_para('historico_pet')
                
                # BOTÃO DE CONTATO (Apenas logado)
                if st.session_state.logado:
                    tel = "".join(filter(str.isdigit, str(pet['Tel_Tutor'])))
                    st.link_button("🟢 Falar com o Tutor", f"https://wa.me/55{tel}", use_container_width=True)
                else:
                    st.button("🔒 Login para Contato", disabled=True, use_container_width=True, key=f"lock_{p_id}")

# --- PÁGINAS DE SUPORTE (MANTIDAS COM A MESMA LÓGICA) ---
elif st.session_state.pagina == 'cadastro_user':
    st.markdown("### 📝 Criar Conta")
    if st.button("⬅️ Voltar ao Mural"): ir_para('home')
    with st.form("cad"):
        n = st.text_input("Nome Completo")
        u = st.text_input("Usuário (Login)")
        p = st.text_input("Senha", type="password")
        t = st.text_input("WhatsApp (com DDD)")
        if st.form_submit_button("CADASTRAR"):
            novo = pd.DataFrame([{"Usuario":u, "Senha":p, "Nome":n, "Telefone":t}])
            conn.update(worksheet=ABA_USUARIOS, data=pd.concat([ler_planilha(ABA_USUARIOS), novo], ignore_index=True))
            st.success("Conta criada! Faça login no menu lateral."); st.balloons()
