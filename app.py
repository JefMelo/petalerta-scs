import streamlit as st
import pandas as pd
from datetime import datetime
import requests
import base64
import folium
from streamlit_folium import st_folium
# Nova biblioteca para o GPS funcionar de verdade
from streamlit_js_eval import streamlit_js_eval

# 1. Configuração Inicial
st.set_page_config(page_title="PetAlerta SCS", page_icon="🐾", layout="centered")

# --- CONFIGURAÇÕES TÉCNICAS ---
SHEET_ID = "1RyredbJZsCPQvBxXqYmX1vBZJRgYToffm5agPxDBDRk"
IMGBB_API_KEY = "54494e69c28056a133620f4e8be0ab72"
ABA_USUARIOS = "Usuarios"
ABA_PETS = "Dados" 
ABA_AVISTAMENTOS = "Avistamentos"

# --- INICIALIZAÇÃO DE ESTADOS ---
if 'pagina' not in st.session_state: st.session_state.pagina = 'home'
if 'logado' not in st.session_state: st.session_state.logado = False
if 'user' not in st.session_state: st.session_state.user = {}
if 'temp_lat' not in st.session_state: st.session_state.temp_lat = None
if 'temp_lng' not in st.session_state: st.session_state.temp_lng = None
if 'pagina_detalhes' not in st.session_state: st.session_state.pagina_detalhes = None
if 'pet_foco' not in st.session_state: st.session_state.pet_foco = None
if 'map_address' not in st.session_state: st.session_state.map_address = None

SCS_COORDS = [-29.7182, -52.4306]

# --- CONEXÃO G-SHEETS ---
from streamlit_gsheets import GSheetsConnection
conn = st.connection("gsheets", type=GSheetsConnection)

# ==========================================
# 📢 SISTEMA DE POP-UPS (MODAIS)
# ==========================================

@st.dialog("Sucesso!")
def modal_sucesso(mensagem, proxima_pagina='home'):
    st.write(f"### 🎉 {mensagem}")
    if st.button("OK", width='stretch', type="primary"):
        st.session_state.pagina = proxima_pagina
        st.session_state.temp_lat = None
        st.session_state.temp_lng = None
        st.session_state.map_address = None
        st.rerun()

# --- FUNÇÕES GLOBAIS ---
def ler_planilha_direto(nome_aba):
    try:
        df = conn.read(worksheet=nome_aba, ttl=15, dtype=str)
        df = df.dropna(how='all')
        df.columns = df.columns.str.strip()
        df = df.fillna("")
        for col in df.columns:
            if col not in ['Lat', 'Lng']:
                df[col] = df[col].astype(str).str.replace(r'\.0$', '', regex=True).replace('nan', '')
        return df
    except Exception as e:
        st.error(f"Erro ao conectar com a planilha: {e}")
        return pd.DataFrame()

def fazer_upload_imgbb(arquivo):
    if arquivo:
        try:
            url = f"https://api.imgbb.com/1/upload?key={IMGBB_API_KEY}"
            img_b64 = base64.b64encode(arquivo.getvalue()).decode('utf-8')
            payload = {"image": img_b64}
            response = requests.post(url, data=payload)
            data = response.json()
            if data.get("status") == 200: return data["data"]["url"]
        except Exception as e: pass
    return ""

def valor_seguro(linha, coluna):
    pet_dict = dict(linha)
    col_buscada = coluna.lower().replace('ç','c').replace('é','e').replace('í','i').replace('á','a').replace('_', '').replace(' ', '').replace('\n', '').replace('\r', '')
    for chave, valor in pet_dict.items():
        chave_limpa = str(chave).lower().replace('ç','c').replace('é','e').replace('í','i').replace('á','a').replace('_', '').replace(' ', '').replace('\n', '').replace('\r', '').strip()
        if chave_limpa == col_buscada:
            v = str(valor).strip()
            if v and v.lower() not in ['nan', 'none', '']: return v
    return '-'

def obter_endereco(lat, lng):
    try:
        url = f"https://nominatim.openstreetmap.org/reverse?format=json&lat={lat}&lon={lng}&zoom=16"
        headers = {'User-Agent': 'PetAlertaSCS_App/1.0'}
        resp = requests.get(url, headers=headers, timeout=4)
        if resp.status_code == 200:
            dados = resp.json()
            end = dados.get('address', {})
            rua = end.get('road', '')
            bairro = end.get('suburb', end.get('neighbourhood', ''))
            if rua and bairro: return f"{rua}, {bairro}"
            if rua: return rua
            if bairro: return bairro
            display = dados.get('display_name', '')
            return display.split(',')[0] if display else "Localização no mapa"
    except: pass
    return "Localização no mapa"

# --- CSS ADAPTÁVEL ---
st.markdown("""
<style>
    [data-testid="stVerticalBlockBorderWrapper"] > div { border-radius: 12px !important; padding: 10px !important; margin-bottom: 15px !important; }
    .html-card-wrapper { display: flex; gap: 15px; align-items: flex-start; background-color: transparent !important; padding: 5px; border-radius: 10px; color: var(--text-color) !important; font-family: var(--font) !important; }
    .titulo-card { color: var(--text-color) !important; margin: 0px !important; padding: 0px !important; line-height: 1.0 !important; font-size: 1.3rem !important; font-weight: bold !important; }
    .texto-card { color: var(--text-color) !important; margin: 2px 0px !important; font-size: 0.95rem !important; line-height: 1.2 !important; }
    .foto-card { width: 120px !important; height: 120px !important; object-fit: cover !important; border-radius: 10px !important; border: 1px solid var(--secondary-background-color) !important; }
    .avistamento-alerta { color: #FF4B4B !important; font-weight: bold !important; }
    .titulo-hall { color: #2ECC71 !important; margin:0; }
</style>
""", unsafe_allow_html=True)

def ir_para(p):
    st.session_state.pagina = p
    st.session_state.pagina_detalhes = None
    st.rerun()

# --- PÁGINA DE ZOOM ---
if st.session_state.pagina_detalhes:
    st.image(st.session_state.pagina_detalhes, width='stretch')
    if st.button("⬅️ VOLTAR", width='stretch', type="primary"):
        st.session_state.pagina_detalhes = None
        st.rerun()
    st.stop()

# --- SIDEBAR ---
with st.sidebar:
    st.title("🐾 Menu")
    if st.button("🏠 Início (Mural)", width='stretch'): ir_para('home')
    if st.button("🏆 Hall da Fama", width='stretch'): ir_para('hall_fama')
    st.divider()
    if not st.session_state.logado:
        st.subheader("Entrar")
        u_l = st.text_input("Usuário")
        p_l = st.text_input("Senha", type="password")
        if st.button("Entrar", width='stretch', type="primary"):
            df_u = ler_planilha_direto(ABA_USUARIOS)
            user_found = None
            if not df_u.empty:
                for _, r in df_u.iterrows():
                    db_p = str(r.get('Senha', '')).replace('.0', '')
                    if str(r.get('Usuario', '')).lower() == u_l.strip().lower() and db_p == p_l.strip():
                        user_found = r.to_dict()
                        break
            if user_found:
                st.session_state.logado, st.session_state.user = True, user_found
                st.rerun()
            else: st.error("Login inválido")
        if st.button("Criar Conta", width='stretch'): ir_para('cadastro_user')
    else:
        st.success(f"Olá, {st.session_state.user.get('Nome', 'Usuário').split()[0]}")
        if st.button("🐾 Meus Pets", width='stretch'): ir_para('meus_pets')
        if st.button("🚪 Sair", width='stretch'):
            st.session_state.logado = False
            ir_para('home')

# --- PÁGINA: HOME ---
if st.session_state.pagina == 'home':
    st.title("🐾 PetAlerta Santa Cruz do Sul")
    df = ler_planilha_direto(ABA_PETS)
    df_avis = ler_planilha_direto(ABA_AVISTAMENTOS)
    if not df_avis.empty: df_avis['ID_Pet'] = df_avis['ID_Pet'].astype(str).str.strip()

    m = folium.Map(location=SCS_COORDS, zoom_start=14)
    if not df.empty:
        for _, pet in df.iterrows():
            try:
                if valor_seguro(pet, 'Status') == 'Perdido':
                    esp = valor_seguro(pet, 'Especie').lower()
                    
                    if 'cão' in esp or 'cao' in esp:
                        icon_name, icon_color = 'dog', 'orange'
                    elif 'gato' in esp:
                        icon_name, icon_color = 'cat', 'blue'
                    else:
                        icon_name, icon_color = 'paw', 'green'

                    lat_v, lng_v = valor_seguro(pet, 'Lat'), valor_seguro(pet, 'Lng')
                    pet_id = str(valor_seguro(pet, 'ID')).strip()
                    local_mapa = valor_seguro(pet, 'Local_Desaparecimento')
                    
                    if not df_avis.empty:
                        avis_deste_pet = df_avis[df_avis['ID_Pet'] == pet_id]
                        if not avis_deste_pet.empty:
                            ultimo_avis = avis_deste_pet.iloc[-1]
                            lat_v, lng_v = ultimo_avis['Lat'], ultimo_avis['Lng']
                            local_mapa = f"Último avistamento: {ultimo_avis['Bairro']}"
                            icon_color = 'red'

                    if lat_v != '-' and lng_v != '-':
                        folium.Marker(
                            [float(lat_v), float(lng_v)], 
                            popup=f"<b>{valor_seguro(pet, 'Nome_Pet')}</b><br>📍 {local_mapa}", 
                            icon=folium.Icon(color=icon_color, icon=icon_name, prefix='fa')
                        ).add_to(m)
            except: continue
    st_folium(m, width='stretch', height=400)

    if st.session_state.logado:
        if st.button("🚨 REGISTRAR NOVO PET", type="primary", width='stretch'): ir_para('perdi_pet')

    st.subheader("🔍 Mural de Desaparecidos")
    if not df.empty:
        for _, pet in df.iterrows():
            if valor_seguro(pet, 'Status') == 'Perdido':
                with st.container(border=True):
                    pet_id = str(valor_seguro(pet, 'ID')).strip()
                    foto_src = valor_seguro(pet, 'Foto')
                    nome_pet = valor_seguro(pet, 'Nome_Pet')
                    if nome_pet == '-': nome_pet = "Pet sem nome"
                    
                    loc_texto = f"📍 <span class='avistamento-alerta'>Sumiu em:</span> {valor_seguro(pet, 'Local_Desaparecimento')} ({valor_seguro(pet, 'Data')})"
                    if not df_avis.empty:
                        avis_deste_pet = df_avis[df_avis['ID_Pet'] == pet_id]
                        if not avis_deste_pet.empty:
                            tem_avistamento = True
                            ultimo_avis = avis_deste_pet.iloc[-1]
                            loc_texto = f"<span class='avistamento-alerta'>🚨 Último avistamento:</span> {ultimo_avis.get('Bairro', '')} ({ultimo_avis.get('Data_Hora', '')})"
                    
                    st.markdown(f'''
                        <div class="html-card-wrapper">
                            <img src="{foto_src}" class="foto-card" onerror="this.style.display='none'">
                            <div style="flex: 1;">
                                <h3 class="titulo-card">{nome_pet}</h3>
                                <p class="texto-card"><b>Espécie:</b> {valor_seguro(pet, 'Especie')} | <b>Raça:</b> {valor_seguro(pet, 'Raca')}</p>
                                <p class="texto-card"><b>Cor:</b> {valor_seguro(pet, 'Cor')}</p>
                                <p class="texto-card"><b>Características:</b> {valor_seguro(pet, 'Caracteristicas')}</p>
                                <p class="texto-card" style="margin-top: 5px !important;">{loc_texto}</p>
                            </div>
                        </div>
                    ''', unsafe_allow_html=True)
                    
                    if st.session_state.logado:
                        c1, c2, c3, c4 = st.columns(4)
                        with c1:
                            if foto_src and st.button("🔍 Foto", key=f"zf_{pet_id}", width='stretch'):
                                st.session_state.pagina_detalhes = foto_src
                                st.rerun()
                        with c2:
                            tel_bruto = valor_seguro(pet, 'Tel_Tutor')
                            if tel_bruto == '-': tel_bruto = valor_seguro(pet, 'Telefone_Tutor')
                            tel = "".join(filter(str.isdigit, tel_bruto))
                            if len(tel) >= 10: st.link_button("🟢 Whats", f"https://wa.me/55{tel}", width='stretch')
                            else: st.button("🚫 Whats", disabled=True, key=f"w_{pet_id}", width='stretch')
                        with c3:
                            if st.button("👁️ Vi!", key=f"avi_{pet_id}", width='stretch'):
                                st.session_state.pet_foco = dict(pet)
                                ir_para('novo_avistamento')
                        with c4:
                            if st.button("🗺️ Rota", key=f"rota_{pet_id}", width='stretch'):
                                st.session_state.pet_foco = dict(pet)
                                ir_para('historico_pet')
                    else:
                        c1, c2 = st.columns(2)
                        with c1:
                            if st.button("🔍 Ver Foto", key=f"zf_{pet_id}", width='stretch'):
                                st.session_state.pagina_detalhes = foto_src
                                st.rerun()
                        with c2: st.button("🔒 Login p/ Contato", disabled=True, key=f"log_{pet_id}", width='stretch')

# --- PÁGINA: NOVO AVISTAMENTO ---
elif st.session_state.pagina == 'novo_avistamento':
    pet = st.session_state.pet_foco
    st.header(f"👁️ Vi o pet: {valor_seguro(pet, 'Nome_Pet')}")
    if st.button("⬅️ Voltar", width='stretch'): ir_para('home')
    
    m_avi = folium.Map(location=SCS_COORDS, zoom_start=15)
    if st.session_state.temp_lat:
        folium.Marker([st.session_state.temp_lat, st.session_state.temp_lng], icon=folium.Icon(color='red', icon='eye', prefix='fa')).add_to(m_avi)
    
    map_res = st_folium(m_avi, width=700, height=300, key="map_avi")
    if map_res and map_res.get("last_clicked"):
        st.session_state.temp_lat, st.session_state.temp_lng = map_res["last_clicked"]["lat"], map_res["last_clicked"]["lng"]
        st.rerun()

    # NOVO BOTÃO GPS SEGURO
    if st.button("📍 Usar minha localização atual", width='stretch'):
        loc = streamlit_js_eval(js_expressions="navigator.geolocation.getCurrentPosition(pos => { return {lat: pos.coords.latitude, lng: pos.coords.longitude} })")
        if loc:
            st.session_state.temp_lat, st.session_state.temp_lng = loc['lat'], loc['lng']
            with st.spinner("Localizando..."):
                st.session_state.map_address = obter_endereco(st.session_state.temp_lat, st.session_state.temp_lng)
            st.rerun()

    if st.session_state.map_address:
        st.success(f"📍 Local capturado: **{st.session_state.map_address}**")

    with st.form("f_avis"):
        bairro_avi = st.text_input("Referência")
        obs_avi = st.text_area("Observações")
        if st.form_submit_button("📍 SALVAR AVISTAMENTO"):
            if st.session_state.temp_lat:
                end_r = obter_endereco(st.session_state.temp_lat, st.session_state.temp_lng)
                novo_avi = {
                    "ID_Pet": valor_seguro(pet, 'ID'), "Data_Hora": datetime.now().strftime('%d/%m/%Y %H:%M'),
                    "Lat": str(st.session_state.temp_lat), "Lng": str(st.session_state.temp_lng),
                    "Bairro": f"{end_r} - {bairro_avi}" if bairro_avi else end_r,
                    "Observacao": obs_avi, "Usuario": st.session_state.user.get('Usuario', '')
                }
                df_av = ler_planilha_direto(ABA_AVISTAMENTOS)
                conn.update(worksheet=ABA_AVISTAMENTOS, data=pd.concat([df_av, pd.DataFrame([novo_avi])], ignore_index=True))
                st.cache_data.clear()
                modal_sucesso("Avistamento registrado com sucesso!")
            else: st.error("Clique no mapa ou use o botão de localização.")

# --- PÁGINA: REGISTRO PET ---
elif st.session_state.pagina == 'perdi_pet':
    st.header("🚨 Registrar Pet Perdido")
    st.info("Clique no mapa ou use o botão abaixo para indicar o local.")
    if st.button("⬅️ Voltar", width='stretch'): ir_para('home')

    m_reg = folium.Map(location=SCS_COORDS, zoom_start=15)
    if st.session_state.temp_lat:
        folium.Marker([st.session_state.temp_lat, st.session_state.temp_lng], icon=folium.Icon(color='red')).add_to(m_reg)
    
    map_res = st_folium(m_reg, width=700, height=300, key="map_reg")
    if map_res and map_res.get("last_clicked"):
        st.session_state.temp_lat, st.session_state.temp_lng = map_res["last_clicked"]["lat"], map_res["last_clicked"]["lng"]
        with st.spinner("Convertendo endereço..."):
            st.session_state.map_address = obter_endereco(st.session_state.temp_lat, st.session_state.temp_lng)
        st.rerun()

    # NOVO BOTÃO GPS SEGURO
    if st.button("📍 Usar minha localização atual", width='stretch'):
        loc = streamlit_js_eval(js_expressions="navigator.geolocation.getCurrentPosition(pos => { return {lat: pos.coords.latitude, lng: pos.coords.longitude} })")
        if loc:
            st.session_state.temp_lat, st.session_state.temp_lng = loc['lat'], loc['lng']
            with st.spinner("Localizando..."):
                st.session_state.map_address = obter_endereco(st.session_state.temp_lat, st.session_state.temp_lng)
            st.rerun()

    if st.session_state.map_address:
        st.success(f"📍 Local capturado: **{st.session_state.map_address}**")

    with st.form("f_pet"):
        n_p = st.text_input("Nome do Pet*")
        esp = st.selectbox("Espécie", ["Cão", "Gato"])
        raca, cor, caract = st.text_input("Raça"), st.text_input("Cor"), st.text_area("Características")
        bairro = st.text_input("Referência (Opcional)")
        foto = st.file_uploader("Foto")
        
        if st.form_submit_button("🚀 PUBLICAR"):
            if n_p and st.session_state.temp_lat:
                url_f = fazer_upload_imgbb(foto)
                end_completo = f"{st.session_state.map_address} - {bairro}" if bairro else st.session_state.map_address
                d = {
                    "ID": str(int(datetime.now().timestamp())), "Status": "Perdido", "Data": datetime.now().strftime('%d/%m/%Y'),
                    "Especie": esp, "Nome_Pet": n_p, "Raca": raca, "Cor": cor, "Caracteristicas": caract, 
                    "Local_Desaparecimento": end_completo, "Lat": str(st.session_state.temp_lat), 
                    "Lng": str(st.session_state.temp_lng), "Foto": url_f,
                    "User_Vinculo": st.session_state.user.get('Usuario', ''), 
                    "Tel_Tutor": st.session_state.user.get('Telefone', '')
                }
                df_p = ler_planilha_direto(ABA_PETS)
                conn.update(worksheet=ABA_PETS, data=pd.concat([df_p, pd.DataFrame([d])], ignore_index=True))
                st.cache_data.clear()
                modal_sucesso("Pet registrado com sucesso!")
            else: st.error("Preencha o nome e indique o local no mapa.")

# --- DEMAIS PÁGINAS MANTIDAS ---
elif st.session_state.pagina == 'hall_fama':
    st.title("🏆 Hall da Fama")
    df = ler_planilha_direto(ABA_PETS)
    if not df.empty:
        for _, pet in df.iterrows():
            if valor_seguro(pet, 'Status') == 'Encontrado':
                with st.container(border=True):
                    st.markdown(f'''<div class="html-card-wrapper"><img src="{valor_seguro(pet, 'Foto')}" class="foto-card"><div><h3 class="titulo-hall">🎉 {valor_seguro(pet, 'Nome_Pet')}</h3><p class="texto-card"><b>Espécie:</b> {valor_seguro(pet, 'Especie')} | <b>Raça:</b> {valor_seguro(pet, 'Raca')}</p><p class="texto-card" style="font-weight: bold; margin-top: 5px;">Este pet já voltou para casa! ❤️</p></div></div>''', unsafe_allow_html=True)
                    if valor_seguro(pet, 'Foto') and st.button("🔍 Foto", key=f"z_{valor_seguro(pet, 'ID')}", width='stretch'):
                        st.session_state.pagina_detalhes = valor_seguro(pet, 'Foto'); st.rerun()

elif st.session_state.pagina == 'meus_pets':
    st.header("🐾 Minhas Publicações")
    df = ler_planilha_direto(ABA_PETS)
    u_log = str(st.session_state.user.get('Usuario', '')).lower()
    meus = df[df.apply(lambda r: str(r.get('User_Vinculo', '')).lower() == u_log, axis=1)]
    for idx, pet in meus.iterrows():
        with st.container(border=True):
            st.subheader(valor_seguro(pet, 'Nome_Pet'))
            if valor_seguro(pet, 'Status') == 'Perdido':
                if st.button("🎉 MARCAR COMO ENCONTRADO", key=f"enc_{idx}", type="primary", width='stretch'):
                    df.loc[idx, 'Status'] = 'Encontrado'; conn.update(worksheet=ABA_PETS, data=df); st.cache_data.clear()
                    modal_sucesso(f"Pet localizado registrado com sucesso!")

elif st.session_state.pagina == 'cadastro_user':
    st.header("📝 Criar Conta")
    with st.form("cad"):
        n, t, u, p = st.text_input("Nome"), st.text_input("Whats (com DDD)"), st.text_input("User"), st.text_input("Senha", type="password")
        if st.form_submit_button("CADASTRAR"):
            if n and t and u and p:
                df_u = ler_planilha_direto(ABA_USUARIOS)
                novo = pd.DataFrame([{"Usuario": u.strip(), "Senha": p.strip(), "Telefone": t.strip(), "Nome": n.strip()}])
                conn.update(worksheet=ABA_USUARIOS, data=pd.concat([df_u, novo], ignore_index=True))
                st.cache_data.clear(); modal_sucesso("Usuário registrado com sucesso!")
