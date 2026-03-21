import streamlit as st
import pandas as pd
from datetime import datetime
import requests
import base64
import folium
from streamlit_folium import st_folium

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

SCS_COORDS = [-29.7182, -52.4306]

# --- CONEXÃO G-SHEETS ---
from streamlit_gsheets import GSheetsConnection
conn = st.connection("gsheets", type=GSheetsConnection)

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

# --- INJEÇÃO DE CSS REFORÇADO (Para contraste total) ---
st.markdown("""
<style>
    /* Forçar fundo branco e borda no contêiner do Streamlit */
    div[data-testid="stVerticalBlockBorderWrapper"] > div {
        background-color: #FFFFFF !important;
        border: 1px solid #DDDDDD !important;
        border-radius: 12px !important;
        padding: 10px !important;
        margin-bottom: 15px !important;
    }

    .pet-card-header h3 { 
        color: #000000 !important; 
        margin: 0 !important; 
        font-size: 1.25rem !important; 
        line-height: 1.0 !important; /* Título mais colado */
        font-weight: bold !important;
    }
    
    .pet-card-body { 
        display: flex; gap: 15px; padding: 10px 0; 
        flex-wrap: wrap; align-items: flex-start;
    }
    
    .pet-card-foto { 
        width: 110px; height: 110px; /* Tamanho médio-compacto */
        object-fit: cover; border-radius: 8px; border: 1px solid #ddd;
    }
    
    .pet-card-info p { 
        margin: 2px 0 !important; 
        font-size: 0.95rem !important; 
        color: #000000 !important; /* Texto Preto Absoluto */
        line-height: 1.4 !important;
    }
    
    .avistamento-destaque { color: #E67E22 !important; font-weight: bold !important; }

    /* Ajuste de botões para ficarem dentro do fluxo */
    .stButton button { margin-top: 5px !important; }
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

# ==========================================
# ROTAS DE PÁGINAS
# ==========================================

# --- PÁGINA: HOME (MURAL DE PERDIDOS) ---
if st.session_state.pagina == 'home':
    st.title("🐾 PetAlerta Santa Cruz do Sul")
    df = ler_planilha_direto(ABA_PETS)
    df_avis = ler_planilha_direto(ABA_AVISTAMENTOS)
    if not df_avis.empty and 'ID_Pet' in df_avis.columns:
        df_avis['ID_Pet'] = df_avis['ID_Pet'].astype(str).str.strip()

    m = folium.Map(location=SCS_COORDS, zoom_start=14)
    if not df.empty:
        for _, pet in df.iterrows():
            try:
                if valor_seguro(pet, 'Status') == 'Perdido':
                    esp = valor_seguro(pet, 'Especie').lower()
                    icon_c = 'orange' if 'cão' in esp or 'cao' in esp else ('blue' if 'gato' in esp else 'green')
                    nome_mapa = valor_seguro(pet, 'Nome_Pet')
                    nome_mapa = "Pet" if nome_mapa == '-' else nome_mapa
                    pet_id = str(valor_seguro(pet, 'ID')).strip()
                    lat_v, lng_v = valor_seguro(pet, 'Lat'), valor_seguro(pet, 'Lng')
                    local_mapa = valor_seguro(pet, 'Local_Desaparecimento')
                    if not df_avis.empty:
                        avis_deste_pet = df_avis[df_avis['ID_Pet'] == pet_id]
                        if not avis_deste_pet.empty:
                            ultimo_avis = avis_deste_pet.iloc[-1]
                            lat_v, lng_v = ultimo_avis['Lat'], ultimo_avis['Lng']
                            local_mapa = f"Último avistamento: {ultimo_avis['Bairro']}"
                            icon_c = 'red'
                    if lat_v != '-' and lng_v != '-':
                        folium.Marker([float(lat_v), float(lng_v)], popup=f"<b>{nome_mapa}</b><br>📍 {local_mapa}", icon=folium.Icon(color=icon_c, icon='paw', prefix='fa')).add_to(m)
            except: continue
    st_folium(m, width='stretch', height=400)

    if st.session_state.logado:
        if st.button("🚨 REGISTRAR PET PERDIDO", type="primary", width='stretch'):
            ir_para('perdi_pet')

    st.subheader("🔍 Mural de Desaparecidos")
    if not df.empty:
        tem_perdido = False
        for _, pet in df.iterrows():
            if valor_seguro(pet, 'Status') == 'Perdido':
                tem_perdido = True
                
                with st.container(border=True):
                    pet_id = str(valor_seguro(pet, 'ID')).strip()
                    foto_src = valor_seguro(pet, 'Foto')
                    if foto_src == '-': foto_src = ""
                    nome_pet = valor_seguro(pet, 'Nome_Pet')
                    if nome_pet == '-': nome_pet = "Pet sem nome"
                    
                    loc_texto = f"📍 <b>Sumiu em:</b> {valor_seguro(pet, 'Local_Desaparecimento')} ({valor_seguro(pet, 'Data')})"
                    tem_avistamento = False
                    if not df_avis.empty:
                        avis_deste_pet = df_avis[df_avis['ID_Pet'] == pet_id]
                        if not avis_deste_pet.empty:
                            tem_avistamento = True
                            ultimo_avis = avis_deste_pet.iloc[-1]
                            loc_texto = f"🚨 <span class='avistamento-destaque'>Último avistamento:</span> {ultimo_avis.get('Bairro', '')} ({ultimo_avis.get('Data_Hora', '')})"
                    
                    # Layout do Card
                    st.markdown(f'''
                        <div class="pet-card-header"><h3>{nome_pet}</h3></div>
                        <div class="pet-card-body">
                            <img src="{foto_src}" class="pet-card-foto" onerror="this.style.display='none'">
                            <div class="pet-card-info">
                                <p><b>Espécie:</b> {valor_seguro(pet, 'Especie')} | <b>Raça:</b> {valor_seguro(pet, 'Raca')}</p>
                                <p><b>Cor:</b> {valor_seguro(pet, 'Cor')}</p>
                                <p><b>Características:</b> {valor_seguro(pet, 'Caracteristicas')}</p>
                                <p>{loc_texto}</p>
                            </div>
                        </div>
                    ''', unsafe_allow_html=True)
                    
                    # Botoes integrados no contêiner
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
                            if tem_avistamento:
                                if st.button("🗺️ Rota", key=f"rota_{pet_id}", width='stretch'):
                                    st.session_state.pet_foco = dict(pet)
                                    ir_para('historico_pet')
                            else: st.button("🗺️ Rota", disabled=True, key=f"rota_dis_{pet_id}", width='stretch')
                    else:
                        c1, c2 = st.columns(2)
                        with c1:
                            if foto_src and st.button("🔍 Ver Foto", key=f"zf_{pet_id}", width='stretch'):
                                st.session_state.pagina_detalhes = foto_src
                                st.rerun()
                        with c2: st.button("🔒 Login p/ Contato", disabled=True, key=f"log_{pet_id}", width='stretch')
                st.write("") 

# --- PÁGINA: REGISTRAR AVISTAMENTO ---
elif st.session_state.pagina == 'novo_avistamento':
    pet = st.session_state.pet_foco
    st.header(f"👁️ Avistamento: {valor_seguro(pet, 'Nome_Pet')}")
    if st.button("⬅️ Voltar", width='stretch'): ir_para('home')
    m_avi = folium.Map(location=SCS_COORDS, zoom_start=15)
    if st.session_state.temp_lat:
        folium.Marker([st.session_state.temp_lat, st.session_state.temp_lng], icon=folium.Icon(color='red', icon='eye', prefix='fa')).add_to(m_avi)
    map_res = st_folium(m_avi, width=700, height=300, key="map_avi")
    if map_res and map_res.get("last_clicked"):
        st.session_state.temp_lat, st.session_state.temp_lng = map_res["last_clicked"]["lat"], map_res["last_clicked"]["lng"]
        st.rerun()
    with st.form("f_avis"):
        bairro_avi = st.text_input("Complemento do Local")
        obs_avi = st.text_area("Observações")
        if st.form_submit_button("📍 SALVAR AVISTAMENTO", type="primary"):
            if st.session_state.temp_lat:
                with st.spinner("Buscando endereço..."):
                    endereco_rua = obter_endereco(st.session_state.temp_lat, st.session_state.temp_lng)
                    local_final = f"{endereco_rua} - {bairro_avi}" if bairro_avi else endereco_rua
                    novo_avi = {
                        "ID_Pet": valor_seguro(pet, 'ID'), "Data_Hora": datetime.now().strftime('%d/%m/%Y %H:%M'),
                        "Lat": str(st.session_state.temp_lat), "Lng": str(st.session_state.temp_lng),
                        "Bairro": local_final, "Observacao": obs_avi, "Usuario": st.session_state.user.get('Usuario', '')
                    }
                    try:
                        df_av = ler_planilha_direto(ABA_AVISTAMENTOS)
                        conn.update(worksheet=ABA_AVISTAMENTOS, data=pd.concat([df_av, pd.DataFrame([novo_avi])], ignore_index=True))
                        st.cache_data.clear()
                        st.session_state.temp_lat = None
                        ir_para('home')
                    except Exception as e: st.error(f"Erro: {e}")
            else: st.error("Clique no mapa.")

# --- PÁGINA: HISTÓRICO/ROTA ---
elif st.session_state.pagina == 'historico_pet':
    pet = st.session_state.pet_foco
    st.header(f"🗺️ Rota: {valor_seguro(pet, 'Nome_Pet')}")
    if st.button("⬅️ Voltar", width='stretch'): ir_para('home')
    df_avis = ler_planilha_direto(ABA_AVISTAMENTOS)
    if not df_avis.empty: df_avis['ID_Pet'] = df_avis['ID_Pet'].astype(str).str.strip()
    avis_deste_pet = df_avis[df_avis['ID_Pet'] == str(valor_seguro(pet, 'ID')).strip()] if not df_avis.empty else pd.DataFrame()
    if not avis_deste_pet.empty:
        lat_orig, lng_orig = valor_seguro(pet, 'Lat'), valor_seguro(pet, 'Lng')
        m_hist = folium.Map(location=[float(lat_orig), float(lng_orig)], zoom_start=14)
        pontos_rota = [[float(lat_orig), float(lng_orig)]]
        folium.Marker([float(lat_orig), float(lng_orig)], popup="Sumiu aqui", icon=folium.Icon(color='black', icon='home', prefix='fa')).add_to(m_hist)
        for i, av in avis_deste_pet.iterrows():
            lat_a, lng_a = float(av['Lat']), float(av['Lng'])
            pontos_rota.append([lat_a, lng_a])
            folium.Marker([lat_a, lng_a], popup=f"{av['Bairro']}", icon=folium.Icon(color='red', icon='eye', prefix='fa')).add_to(m_hist)
        folium.PolyLine(pontos_rota, color="red", weight=2.5).add_to(m_hist)
        st_folium(m_hist, width='stretch', height=400)
        for _, av in avis_deste_pet.iterrows(): st.info(f"📍 **{av['Data_Hora']} - {av['Bairro']}**\n{av['Observacao']}")
    else: st.warning("Sem histórico.")

# --- PÁGINA: HALL DA FAMA ---
elif st.session_state.pagina == 'hall_fama':
    st.title("🏆 Hall da Fama")
    df = ler_planilha_direto(ABA_PETS)
    if not df.empty:
        for _, pet in df.iterrows():
            if valor_seguro(pet, 'Status') == 'Encontrado':
                with st.container(border=True):
                    foto_src = valor_seguro(pet, 'Foto')
                    nome_pet = valor_seguro(pet, 'Nome_Pet')
                    st.markdown(f'''
                        <div class="pet-card-header"><h3>🎉 {nome_pet}</h3></div>
                        <div class="pet-card-body">
                            <img src="{foto_src}" class="pet-card-foto" onerror="this.style.display='none'">
                            <div class="pet-card-info">
                                <p><b>Espécie:</b> {valor_seguro(pet, 'Especie')} | <b>Raça:</b> {valor_seguro(pet, 'Raca')}</p>
                                <p style="color: #27ae60 !important; font-weight: bold;">Este pet já voltou para casa! ❤️</p>
                            </div>
                        </div>
                    ''', unsafe_allow_html=True)
                    if foto_src and st.button("🔍 Foto", key=f"z_{valor_seguro(pet, 'ID')}", width='stretch'):
                        st.session_state.pagina_detalhes = foto_src
                        st.rerun()
                st.write("")

# --- PÁGINA: REGISTRO PET ---
elif st.session_state.pagina == 'perdi_pet':
    st.header("🚨 Registrar Pet Perdido")
    m_reg = folium.Map(location=SCS_COORDS, zoom_start=15)
    if st.session_state.temp_lat: folium.Marker([st.session_state.temp_lat, st.session_state.temp_lng], icon=folium.Icon(color='red')).add_to(m_reg)
    map_res = st_folium(m_reg, width=700, height=300, key="map_reg")
    if map_res and map_res.get("last_clicked"):
        st.session_state.temp_lat, st.session_state.temp_lng = map_res["last_clicked"]["lat"], map_res["last_clicked"]["lng"]
        st.rerun()
    with st.form("f_pet"):
        nome_p = st.text_input("Nome do Pet*")
        esp = st.selectbox("Espécie", ["Cão", "Gato", "Outro"])
        raca, cor = st.text_input("Raça"), st.text_input("Cor")
        caract = st.text_area("Características")
        bairro = st.text_input("Complemento do Local")
        foto = st.file_uploader("Foto")
        if st.form_submit_button("🚀 PUBLICAR"):
            if nome_p and st.session_state.temp_lat:
                with st.spinner("Salvando..."):
                    url_f = fazer_upload_imgbb(foto)
                    end_r = obter_endereco(st.session_state.temp_lat, st.session_state.temp_lng)
                    u = st.session_state.user
                    d = {
                        "ID": str(int(datetime.now().timestamp())), "Status": "Perdido", "Data": datetime.now().strftime('%d/%m/%Y'),
                        "Especie": esp, "Nome_Pet": nome_p, "Raca": raca, "Cor": cor, "Caracteristicas": caract, 
                        "Local_Desaparecimento": f"{end_r} - {bairro}" if bairro else end_r,
                        "Lat": str(st.session_state.temp_lat), "Lng": str(st.session_state.temp_lng), "Foto": url_f,
                        "User_Vinculo": u.get('Usuario', ''), "Tel_Tutor": u.get('Telefone', '')
                    }
                    try:
                        df_p = ler_planilha_direto(ABA_PETS)
                        conn.update(worksheet=ABA_PETS, data=pd.concat([df_p, pd.DataFrame([d])], ignore_index=True))
                        st.cache_data.clear()
                        st.session_state.temp_lat = None
                        ir_para('home')
                    except Exception as e: st.error(f"Erro: {e}")

# --- PÁGINA: MEUS PETS ---
elif st.session_state.pagina == 'meus_pets':
    st.header("🐾 Meus Pets")
    df = ler_planilha_direto(ABA_PETS)
    if not df.empty:
        u_log = str(st.session_state.user.get('Usuario', '')).lower()
        meus = df[df.apply(lambda r: str(r.get('User_Vinculo', '')).lower() == u_log, axis=1)]
        if not meus.empty:
            for idx, pet in meus.iterrows():
                with st.container(border=True):
                    st.subheader(valor_seguro(pet, 'Nome_Pet'))
                    st.write(f"Status: {valor_seguro(pet, 'Status')}")
                    if valor_seguro(pet, 'Status') == 'Perdido':
                        if st.button("🎉 ENCONTRADO", key=f"e_{idx}", type="primary", width='stretch'):
                            df.loc[idx, 'Status'] = 'Encontrado'
                            conn.update(worksheet=ABA_PETS, data=df)
                            st.cache_data.clear()
                            st.rerun()
        else: st.info("Nenhum pet.")

# --- PÁGINA: CADASTRO USER ---
elif st.session_state.pagina == 'cadastro_user':
    st.header("📝 Criar Conta")
    with st.form("cad"):
        n, t, u, p = st.text_input("Nome"), st.text_input("Whats"), st.text_input("User"), st.text_input("Senha", type="password")
        if st.form_submit_button("CADASTRAR"):
            df_u = ler_planilha_direto(ABA_USUARIOS)
            novo = pd.DataFrame([{"Usuario":u,"Senha":p,"Telefone":t,"Nome":n}])
            conn.update(worksheet=ABA_USUARIOS, data=pd.concat([df_u, novo], ignore_index=True))
            st.cache_data.clear()
            ir_para('home')
